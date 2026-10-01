import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { and, eq } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import * as schema from './schema';
import type { Thread } from '../../lib/models';
import type { LaunchInput } from '../../shared/runtime';

export class MetadataDatabase {
  readonly sqlite: Database.Database;
  readonly db;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.sqlite = new Database(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.sqlite.pragma('journal_mode = WAL');
    this.sqlite.pragma('foreign_keys = ON');
    this.db = drizzle(this.sqlite, { schema });
    migrate(this.db, { migrationsFolder: fileURLToPath(new URL('../../../drizzle', import.meta.url)) });
  }
  close() { this.sqlite.close(); }
  getSetting(key: string) { return this.db.select().from(schema.settings).where(eq(schema.settings.key, key)).get()?.value; }
  setSetting(key: string, value: string) { this.db.insert(schema.settings).values({ key, value }).onConflictDoUpdate({ target: schema.settings.key, set: { value } }).run(); }
  threadRows(machineId?: string, session?: string) {
    return this.db.select().from(schema.threads).where(machineId ? and(eq(schema.threads.machineId, machineId), eq(schema.threads.session, session!)) : undefined).all();
  }
  saveThread(thread: Thread, anchors: string[], alias: string | null = null) {
    const row = { id: thread.id, machineId: thread.machineId, session: thread.session, alias, metadata: thread, anchors, avatar: thread.avatarIndex };
    this.db.insert(schema.threads).values(row).onConflictDoUpdate({ target: schema.threads.id, set: row }).run();
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
}
