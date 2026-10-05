import { NodeSqliteClient } from './node-sqlite-client';
import { openMigratedDrizzle } from './drizzle-node-sqlite';
import { and, desc, eq, lte, max } from 'drizzle-orm';
import type { DeviceSession } from '../auth/sessions';
import type { AuditEvent } from '../auth/audit';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import * as schema from './schema';
import type { Thread } from '../../lib/models';
import type { LaunchInput } from '../../shared/runtime';

const AUDIT_RETENTION = 200;

export class MetadataDatabase {
  readonly sqlite: NodeSqliteClient;
  readonly db;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.sqlite = new NodeSqliteClient(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON');
    this.db = openMigratedDrizzle(this.sqlite, schema, fileURLToPath(new URL('../../../drizzle', import.meta.url)));
  }
  close() { this.sqlite.close(); }
  getSetting(key: string) { return this.db.select().from(schema.settings).where(eq(schema.settings.key, key)).get()?.value; }
  deleteSetting(key: string) { this.db.delete(schema.settings).where(eq(schema.settings.key, key)).run(); }
  setSetting(key: string, value: string) { this.db.insert(schema.settings).values({ key, value }).onConflictDoUpdate({ target: schema.settings.key, set: { value } }).run(); }
  threadRows(machineId?: string, session?: string) {
    return this.db.select().from(schema.threads).where(machineId ? and(eq(schema.threads.machineId, machineId), session ? eq(schema.threads.session, session) : undefined) : undefined).all();
  }
  nextAvatarIndex() { return (this.db.select({ last: max(schema.threads.avatar) }).from(schema.threads).get()?.last ?? -1) + 1; }
  saveThread(thread: Thread, anchors: string[], alias: string | null = null) {
    const row = { id: thread.id, machineId: thread.machineId, session: thread.session, alias, metadata: thread, anchors, avatar: thread.avatarIndex };
    this.db.insert(schema.threads).values(row).onConflictDoUpdate({ target: schema.threads.id, set: row }).run();
  }
  deleteThread(id: string) {
    this.db.transaction(() => {
      this.db.delete(schema.operations).where(eq(schema.operations.threadId, id)).run();
      this.db.delete(schema.threads).where(eq(schema.threads.id, id)).run();
    });
  }
  beginLaunch(accountId: string, key: string, input: LaunchInput, thread: Thread) {
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    return this.db.transaction(() => {
      const existing = this.db.select().from(schema.operations).where(and(eq(schema.operations.accountId, accountId), eq(schema.operations.key, key))).get();
      if (existing) {
        if (existing.hash !== hash) throw new Error('idempotency_conflict');
        return { operation: existing, created: false };
      }
      const operation = { id: randomUUID(), accountId, key, hash, threadId: thread.id, input, state: 'pending', step: 'validate', result: {} };
      this.db.insert(schema.operations).values(operation).run();
      this.saveThread(thread, []);
      return { operation, created: true };
    });
  }
  updateOperation(id: string, state: string, step: string, result: Record<string, unknown>) {
    this.db.update(schema.operations).set({ state, step, result }).where(eq(schema.operations.id, id)).run();
  }
  operation(id: string) { return this.db.select().from(schema.operations).where(eq(schema.operations.id, id)).get(); }
  operations() { return this.db.select().from(schema.operations).all(); }
  markInterruptedLaunches() {
    for (const operation of this.operations()) if (operation.state === 'pending' || operation.state === 'running') this.updateOperation(operation.id, 'unknown', operation.step, operation.result);
  }
  registerProfile(id: string, session: string, metadata: string, locations: { projectId: string; path: string }[]) {
    const previous = this.db.select().from(schema.profiles).where(eq(schema.profiles.id, id)).get();
    const configVersion = previous ? previous.configVersion + Number(previous.metadata !== metadata || previous.session !== session) : 1;
    this.db.transaction(() => {
      this.db.insert(schema.profiles).values({ id, session, metadata, configVersion }).onConflictDoUpdate({ target: schema.profiles.id, set: { session, metadata, configVersion } }).run();
      this.db.delete(schema.projectLocations).where(eq(schema.projectLocations.machineId, id)).run();
      for (const location of locations) this.db.insert(schema.projectLocations).values({ id: id + ':' + location.projectId, machineId: id, projectId: location.projectId, path: location.path }).run();
    });
    return configVersion;
  }
  addDeviceSession(session: DeviceSession & { tokenHash: string }) { this.db.insert(schema.deviceSessions).values(session).run(); }
  deviceSessionByTokenHash(tokenHash: string) { return this.db.select().from(schema.deviceSessions).where(eq(schema.deviceSessions.tokenHash, tokenHash)).get(); }
  deviceSessions() { return this.db.select({ id: schema.deviceSessions.id, name: schema.deviceSessions.name, createdAt: schema.deviceSessions.createdAt, lastSeenAt: schema.deviceSessions.lastSeenAt }).from(schema.deviceSessions).all(); }
  touchDeviceSession(id: string, lastSeenAt: number) { this.db.update(schema.deviceSessions).set({ lastSeenAt }).where(eq(schema.deviceSessions.id, id)).run(); }
  deleteDeviceSession(id: string) { return this.db.delete(schema.deviceSessions).where(eq(schema.deviceSessions.id, id)).run().changes > 0; }
  addAuditEvent(event: Omit<AuditEvent, 'id'>) {
    this.db.transaction(() => {
      this.db.insert(schema.auditEvents).values(event).run();
      const oldest = this.db.select({ id: schema.auditEvents.id }).from(schema.auditEvents).orderBy(desc(schema.auditEvents.id)).limit(1).offset(AUDIT_RETENTION).get();
      if (oldest) this.db.delete(schema.auditEvents).where(lte(schema.auditEvents.id, oldest.id)).run();
    });
  }
  auditEvents(limit: number): AuditEvent[] { return this.db.select().from(schema.auditEvents).orderBy(desc(schema.auditEvents.id)).limit(limit).all() as AuditEvent[]; }
}
