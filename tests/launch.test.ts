import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { MetadataDatabase } from '../src/server/storage/database';
import { LaunchJournal } from '../src/server/runtime/launch';
import { FakeTarget, launch } from './fixtures/target';
import { reconcile } from '../src/server/runtime/reconcile';
import { isListedThread } from '../src/lib/launch';

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
it('preserves a deleted launch outcome as a prompt-free idempotency tombstone', async () => {
  const { db, target, journal } = setup(); const key = randomUUID();
  const accepted = journal.submit('owner', key, launch, target);
  await expect.poll(() => db.operation(accepted.operationId)?.state).toBe('ready');
  const effects = [...target.effects]; db.deleteThread(accepted.id);
  expect(db.operation(accepted.operationId)).toMatchObject({ state: 'ready', threadId: accepted.id });
  expect(db.findLaunch('owner', 'thread', key, launch)).toMatchObject({ id: accepted.operationId, threadId: accepted.id });
  const replay = journal.submit('owner', key, launch, target);
  expect(replay.operationId).toBe(accepted.operationId); expect(replay.id).toBe(accepted.id); expect(target.effects).toEqual(effects);
  expect(() => journal.submit('owner', key, { ...launch, prompt: 'changed' }, target)).toThrow('idempotency_conflict');
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
  const { operation } = db.beginLaunch('owner', randomUUID(), launch, thread, target);
  new LaunchJournal(db, () => {}); expect(db.operation(operation.id)?.state).toBe('unknown'); expect(target.effects).toEqual([]);
});
it('keeps a failed launch listed for ten minutes after the failure, not after its creation', () => {
  const { db, target } = setup(); const thread = reconcile(db, target, target.state).threads[0];
  const { operation } = db.beginLaunch('owner', randomUUID(), launch, thread, target);
  const row = db.threadRows()[0];
  db.saveThread({ ...thread, updatedAt: new Date(Date.now() - 15 * 60_000).toISOString() }, row.anchors, row.alias);
  db.updateOperation(operation.id, 'failed', 'checkout', {});
  expect(isListedThread({ ...db.threadRows()[0].metadata, panes: [], operation: { id: operation.id, state: 'failed', step: 'checkout' } }, Date.now() + 5 * 60_000)).toBe(true);
});
it('stops queued effects during gateway shutdown without starting, prompting or deleting anything', async () => {
  const { target, journal } = setup(); journal.submit('owner', randomUUID(), launch, target);
  await journal.stop(); expect(target.effects).toEqual([]); expect(() => journal.submit('owner', randomUUID(), launch, target)).toThrow('gateway_stopping');
});
it('keeps catalogs and custom model choices isolated to the selected host', async () => {
  const { db, target, journal } = setup(); const other = new FakeTarget(); other.id = 'remote';
  const result = journal.submit('owner', randomUUID(), { ...launch, machineId: 'remote', projectId: 'remote:project', model: 'remote/custom-model' }, other);
  await expect.poll(() => db.operation(result.operationId)?.state).toBe('ready');
  expect(target.effects).toEqual([]); expect(db.operations().find((operation) => operation.id === result.operationId)?.input.model).toBe('remote/custom-model');
});
it('caps accepted pending launches at 32 per owner and machine before recording more work', async () => {
  const { db, target, journal } = setup();
  let enter!: () => void; let release!: () => void; let first = true;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  target.catalog = async () => { if (first) { first = false; enter(); await gate; } throw new Error('launch_unavailable'); };
  for (let index = 0; index < 32; index++) journal.submit('owner', randomUUID(), { ...launch, prompt: `Prompt ${index}` }, target);
  await entered;
  expect(db.operations()).toHaveLength(32);
  expect(() => journal.submit('owner', randomUUID(), launch, target)).toThrow('launch_capacity_exceeded');
  expect(db.operations()).toHaveLength(32);
  release(); await journal.stop(); expect(target.effects).toEqual([]);
});
it('does not execute a captured launch after its target configuration changes during catalog lookup', async () => {
  const { db, target, journal } = setup();
  let enter!: () => void; let release!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const catalog = target.catalog.bind(target);
  target.catalog = async () => { enter(); await gate; return catalog(); };
  const accepted = journal.submit('owner', randomUUID(), launch, target);
  await entered; target.configVersion += 1; release();
  await expect.poll(() => db.operation(accepted.operationId)?.state).toBe('failed');
  expect(target.effects).toEqual([]);
});
it.each(['startup', 'reconciliation'])('persists provider identity from %s before the first prompt without clobbering concurrent capture', async (source) => {
  const { db, target, journal } = setup();
  const providerSession = { source: 'herdr:claude', agent: 'claude', kind: 'id' as const, value: 'durable-provider-id' };
  const originalStart = target.start.bind(target); const originalPrompt = target.prompt.bind(target);
  target.start = async (input, paneId, threadId, ownerToken) => {
    const before = db.threadRows(target.id).find((row) => row.id === threadId)!;
    expect(before.metadata.ownerToken).toBe(ownerToken); expect(ownerToken).toMatch(/^[0-9a-f-]{36}$/);
    expect(before.metadata).toMatchObject({ expectedCwd: '/fixture', expectedRepository: 'fixture', expectedCheckout: '/fixture' });
    await originalStart(input, paneId, threadId, ownerToken);
    if (source === 'startup') return { providerSession, observedCwd: '/fixture' };
    db.saveThread({ ...before.metadata, providerSession, recovery: { state: 'active' } }, before.anchors, before.alias);
    return {};
  };
  target.prompt = async (paneId, prompt, terminalId) => {
    const saved = db.threadRows(target.id).find((row) => row.anchors.includes(terminalId))!;
    expect(saved.metadata.providerSession).toEqual(providerSession); expect(saved.metadata.recovery?.state).toBe('active'); expect(saved.metadata.observedCwd).toBe('/fixture');
    await originalPrompt(paneId, prompt, terminalId);
  };
  const operation = journal.submit('owner', randomUUID(), launch, target);
  await expect.poll(() => db.operation(operation.operationId)?.state).toBe('ready');
  expect(target.effects).toEqual(['checkout', 'start', 'prompt']);
  expect(db.threadRows(target.id).find((row) => row.id === operation.id)?.metadata.providerSession).toEqual(providerSession);
});
it('keeps missing startup reports unbound without delaying or replaying the initial prompt', async () => {
  const { db, target, journal } = setup();
  const key = randomUUID(); const operation = journal.submit('owner', key, launch, target);
  await expect.poll(() => db.operation(operation.operationId)?.state).toBe('ready');
  const thread = db.threadRows(target.id).find((row) => row.id === operation.id)!.metadata;
  expect(thread.providerSession).toBeUndefined(); expect(thread.recovery?.state).toBe('unbound');
  journal.submit('owner', key, launch, target);
  expect(target.effects).toEqual(['checkout', 'start', 'prompt']);
});

it('does not send the first prompt when the started agent reports a different checkout', async () => {
  const { db, target, journal } = setup();
  const originalStart = target.start.bind(target);
  target.start = async (input, paneId, threadId, ownerToken) => {
    await originalStart(input, paneId, threadId, ownerToken);
    return { observedCwd: '/different-checkout' };
  };
  const operation = journal.submit('owner', randomUUID(), launch, target);
  await expect.poll(() => db.operation(operation.operationId)?.state).toBe('unknown');
  expect(target.effects).toEqual(['checkout', 'start']);
  expect(db.threadRows(target.id).find((row) => row.id === operation.id)?.metadata.expectedCwd).toBe('/fixture');
});
