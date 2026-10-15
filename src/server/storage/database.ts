import { NodeSqliteClient } from './node-sqlite-client';
import { openMigratedDrizzle } from './drizzle-node-sqlite';
import { and, desc, eq, inArray, lte, max, sql } from 'drizzle-orm';
import type { DeviceSession } from '../auth/sessions';
import type { AuditEvent } from '../auth/audit';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import * as schema from './schema';
import type { Thread } from '../../lib/models';
import { launchInput, type LaunchInput } from '../../shared/runtime';

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
  settingsWithPrefix(prefix: string) { return this.db.select().from(schema.settings).where(sql`substr(${schema.settings.key}, 1, ${prefix.length}) = ${prefix}`).all(); }
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
      const operations = this.db.select().from(schema.operations).where(eq(schema.operations.threadId, id)).all();
      for (const operation of operations) this.db.insert(schema.launchTombstones).values({
        id: operation.id, accountId: operation.accountId, kind: operation.kind, key: operation.key, hash: operation.hash,
        threadId: operation.threadId, state: operation.state, step: operation.step, result: { threadId: operation.threadId }, error: operation.error,
      }).run();
      this.db.delete(schema.operations).where(eq(schema.operations.threadId, id)).run();
      this.db.delete(schema.threads).where(eq(schema.threads.id, id)).run();
    });
  }
  private launchHash(input: LaunchInput) { return createHash('sha256').update(JSON.stringify(launchInput.parse(input))).digest('hex'); }
  findLaunch(accountId: string, kind: string, key: string, input: LaunchInput) {
    const hash = this.launchHash(input);
    const operation = this.db.select().from(schema.operations).where(and(eq(schema.operations.accountId, accountId), eq(schema.operations.kind, kind), eq(schema.operations.key, key))).get();
    const tombstone = operation ? undefined : this.db.select().from(schema.launchTombstones).where(and(eq(schema.launchTombstones.accountId, accountId), eq(schema.launchTombstones.kind, kind), eq(schema.launchTombstones.key, key))).get();
    const existing = operation ?? tombstone;
    if (existing && existing.hash !== hash) throw new Error('idempotency_conflict');
    return existing;
  }
  beginLaunch(accountId: string, key: string, input: LaunchInput, thread: Thread, target: { fingerprint: string; session: string; configVersion: number }, kind = 'thread') {
    const normalizedInput = launchInput.parse(input);
    const hash = this.launchHash(normalizedInput);
    return this.sqlite.transaction(() => {
      const existing = this.db.select().from(schema.operations).where(and(eq(schema.operations.accountId, accountId), eq(schema.operations.kind, kind), eq(schema.operations.key, key))).get()
        ?? this.db.select().from(schema.launchTombstones).where(and(eq(schema.launchTombstones.accountId, accountId), eq(schema.launchTombstones.kind, kind), eq(schema.launchTombstones.key, key))).get();
      if (existing) {
        if (existing.hash !== hash) throw new Error('idempotency_conflict');
        return { operation: existing, created: false };
      }
      const active = this.db.select({ count: sql<number>`count(*)` }).from(schema.operations).where(and(
        eq(schema.operations.accountId, accountId), sql`json_extract(${schema.operations.input}, '$.machineId') = ${normalizedInput.machineId}`,
        inArray(schema.operations.state, ['pending', 'running']),
      )).get()?.count ?? 0;
      if (active >= 32) throw new Error('launch_capacity_exceeded');
      const operation = {
        id: randomUUID(), accountId, kind, key, hash, threadId: thread.id, input: normalizedInput,
        targetFingerprint: target.fingerprint, targetSession: target.session, targetConfigVersion: target.configVersion,
        state: 'pending', step: 'validate', result: {}, error: null,
      };
      this.db.insert(schema.operations).values(operation).run();
      this.saveThread(thread, []);
      return { operation, created: true };
    }).immediate();
  }
  updateOperation(id: string, state: string, step: string, result: Record<string, unknown>, error?: string) {
    const operation = this.db.select().from(schema.operations).where(eq(schema.operations.id, id)).get();
    this.db.update(schema.operations).set({ state, step, result, error: error ?? null }).where(eq(schema.operations.id, id)).run();
    const row = operation && this.db.select().from(schema.threads).where(eq(schema.threads.id, operation.threadId)).get();
    // Launch lifecycle transitions are updates too: they anchor the failed-launch listing window
    // to the moment of failure instead of the thread's creation. Callers may already hold a
    // transaction open, so these statements must not open their own.
    if (row) this.db.update(schema.threads).set({ metadata: { ...row.metadata, updatedAt: new Date().toISOString() } }).where(eq(schema.threads.id, row.id)).run();
  }
  operation(id: string) {
    return this.db.select().from(schema.operations).where(eq(schema.operations.id, id)).get()
      ?? this.db.select().from(schema.launchTombstones).where(eq(schema.launchTombstones.id, id)).get();
  }
  operations() { return this.db.select().from(schema.operations).all(); }
  markInterruptedLaunches() {
    for (const operation of this.operations()) if (operation.state === 'pending' || operation.state === 'running') this.updateOperation(operation.id, 'unknown', operation.step, operation.result, 'launch_interrupted');
  }
  recoveryScope(owner: string) {
    let namespace = this.getSetting('server_namespace');
    if (!namespace) {
      this.db.insert(schema.settings).values({ key: 'server_namespace', value: randomUUID() }).onConflictDoNothing().run();
      namespace = this.getSetting('server_namespace');
    }
    return createHash('sha256').update(JSON.stringify(['webr:recovery-scope:v1', namespace, owner])).digest('base64url');
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
