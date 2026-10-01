import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { MetadataDatabase } from '../src/server/storage/database';
import { LaunchJournal } from '../src/server/runtime/launch';
import { FakeTarget, launch } from './fixtures/target';
import { reconcile } from '../src/server/runtime/reconcile';

const databases: MetadataDatabase[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function setup() { const db = new MetadataDatabase(':memory:'); databases.push(db); const target = new FakeTarget(); return { db, target, journal: new LaunchJournal(db, () => {}) }; }
it('returns stable full UUID operation and thread IDs for repeated account-scoped keys and rejects conflicts', async () => {
  const { db, target, journal } = setup(); const key = randomUUID();
  const first = journal.submit('owner', key, launch, target); const second = journal.submit('owner', key, launch, target);
  expect(second.id).toBe(first.id); expect(second.operationId).toBe(first.operationId); expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(() => journal.submit('owner', key, { ...launch, prompt: 'different' }, target)).toThrow('idempotency_conflict');
  await expect.poll(() => db.operation(first.operationId)?.state).toBe('ready');
  expect(target.effects).toEqual(['checkout', 'start', 'prompt']);
});
it.each(['checkout:before', 'checkout:after', 'start:before', 'start:after', 'prompt:before', 'prompt:after'])('journals uncertain %s failures and never retries effects, prompts, or cleanup', async (failure) => {
  const { db, target, journal } = setup(); target.failure = failure; const key = randomUUID();
  const result = journal.submit('owner', key, launch, target);
  await expect.poll(() => db.operation(result.operationId)?.state).toBe('unknown');
  const effects = [...target.effects];
  const recovered = new LaunchJournal(db, () => {}); recovered.submit('owner', key, launch, target);
  await new Promise((resolve) => setTimeout(resolve, 10)); expect(target.effects).toEqual(effects); expect(target.effects.filter((effect) => effect === 'prompt').length).toBeLessThanOrEqual(1);
});
it('marks an interrupted durable intent as unknown instead of replaying it', () => {
  const { db, target } = setup(); const thread = reconcile(db, target, target.state).threads[0];
  const { operation } = db.beginLaunch('owner', randomUUID(), launch, thread);
  new LaunchJournal(db, () => {}); expect(db.operation(operation.id)?.state).toBe('unknown'); expect(target.effects).toEqual([]);
});
it('stops queued effects during gateway shutdown without starting, prompting or deleting anything', async () => {
  const { target, journal } = setup(); journal.submit('owner', randomUUID(), launch, target);
  await journal.stop(); expect(target.effects).toEqual([]); expect(() => journal.submit('owner', randomUUID(), launch, target)).toThrow('gateway_stopping');
});
it('keeps catalogs and custom model choices isolated to the selected host', async () => {
  const { db, target, journal } = setup(); const other = new FakeTarget(); other.id = 'remote';
  const result = journal.submit('owner', randomUUID(), { ...launch, machineId: 'remote', projectId: 'remote:project', model: 'remote/custom-model' }, other);
  await expect.poll(() => db.operation(result.operationId)?.state).toBe('ready');
  expect(target.effects).toEqual([]); expect(db.operation(result.operationId)?.input.model).toBe('remote/custom-model');
});
