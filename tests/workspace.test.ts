import { expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { MetadataDatabase } from '../src/server/storage/database';
import { RuntimeManager } from '../src/server/runtime/manager';
import { FakeTarget, snapshot } from './fixtures/target';
import { nativeLocations } from '../src/server/transport/native-locations';

const input = { machineId: 'fixture', path: '/project', label: 'Project' };
const result = { workspaceId: 'w2', tabId: 'w2:t1', paneId: 'w2:p1', terminalId: 'term_workspace' };

it('stores normalized owner-scoped create tombstones permanently and conflicts on changed payloads', () => {
  const database = new MetadataDatabase(':memory:'); const key = randomUUID();
  const target = { fingerprint: 'fixture:source-v1', session: 'fixture', configVersion: 1 };
  try {
    const accepted = database.beginCreateOperation('local', 'workspace', key, input, target);
    expect(accepted).toMatchObject({ created: true, operation: { state: 'pending', input } });
    database.updateCreateOperation(accepted.operation.id, 'ready', 'ready', result);
    expect(database.createOperation(accepted.operation.id)).toMatchObject({ state: 'ready', input: null, result });
    expect(database.beginCreateOperation('local', 'workspace', key, input, target)).toMatchObject({ created: false, operation: { id: accepted.operation.id, state: 'ready', nativeRequestId: accepted.operation.nativeRequestId } });
    expect(() => database.beginCreateOperation('local', 'workspace', key, { ...input, label: 'Changed' }, target)).toThrow('idempotency_conflict');
    expect(database.beginCreateOperation('local', 'terminal', key, { machineId: input.machineId, path: input.path }, target).created).toBe(true);
  } finally { database.close(); }
});

it('accepts before native work and never replays an uncertain native create', async () => {
  const database = new MetadataDatabase(':memory:'); const target = new FakeTarget();
  const manager = new RuntimeManager(database, [target]); const key = randomUUID();
  const create = vi.fn(async (_path: string, _label: string, _requestId: string) => { throw new Error('rpc_timeout'); });
  target.createWorkspace = create;
  try {
    manager.start(); await expect.poll(() => manager.bootstrap().machines[0]?.connected).toBe(true);
    const accepted = manager.acceptCreateOperation('local', 'workspace', key, input);
    expect(accepted.envelope).toMatchObject({ kind: 'workspace', state: 'pending', step: 'validate' });
    expect(create).not.toHaveBeenCalled();
    manager.startCreateOperation(accepted.envelope.operationId);
    await expect.poll(() => database.createOperation(accepted.envelope.operationId)?.state).toBe('unknown');
    expect(create).toHaveBeenCalledOnce();
    const nativeRequestId = database.createOperation(accepted.envelope.operationId)?.nativeRequestId;
    expect(create.mock.calls[0]?.[2]).toBe(nativeRequestId);
    const repeated = manager.acceptCreateOperation('local', 'workspace', key, input);
    expect(repeated.envelope).toMatchObject({ operationId: accepted.envelope.operationId, state: 'unknown' });
    expect(create).toHaveBeenCalledOnce();
  } finally { await manager.close(); database.close(); }
});

it('marks a running create unknown on manager restart and preserves its native request ID', () => {
  const database = new MetadataDatabase(':memory:'); const target = new FakeTarget(); const key = randomUUID(); const nativeRequestId = randomUUID();
  const accepted = database.beginCreateOperation('local', 'workspace', key, input, { fingerprint: target.fingerprint, session: target.session, configVersion: target.configVersion }, { nativeRequestId });
  database.updateCreateOperation(accepted.operation.id, 'running', 'create', {});
  const create = vi.fn(async () => result); target.createWorkspace = create;
  const manager = new RuntimeManager(database, [target]);
  try {
    const recovered = manager.acceptCreateOperation('local', 'workspace', key, input);
    expect(recovered.envelope).toMatchObject({ operationId: accepted.operation.id, state: 'unknown' });
    expect(database.createOperation(accepted.operation.id)?.nativeRequestId).toBe(nativeRequestId);
    manager.startCreateOperation(accepted.operation.id);
    expect(create).not.toHaveBeenCalled();
  } finally { database.close(); }
});

it('compacts legacy create inputs and rejects results with unknown ownership', () => {
  const database = new MetadataDatabase(':memory:'); const target = new FakeTarget(); const key = randomUUID(); const requestId = randomUUID();
  database.setSetting('workspace_operation:' + key, JSON.stringify({ id: requestId, input: JSON.stringify({ fingerprint: target.fingerprint, path: input.path, label: input.label }), state: 'ready', result, error: 'native error at /private/project/path' }));
  const manager = new RuntimeManager(database, [target]);
  const create = vi.fn(async () => result); target.createWorkspace = create;
  try {
    const compact = JSON.parse(database.getSetting('workspace_operation:' + key)!);
    expect(compact).toMatchObject({ legacy: true, id: requestId, state: 'ready', result });
    expect(compact.input).toBeUndefined();
    expect(compact.error).toBeUndefined();
    expect(compact.inputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(() => manager.acceptCreateOperation('local', 'workspace', key, input)).toThrow('legacy_operation_ownership_ambiguous');
    expect(database.createOperations()).toHaveLength(0);
    expect(create).not.toHaveBeenCalled();
  } finally { database.close(); }
});

it('does not expose incomplete legacy results whose ownership cannot be proven', () => {
  const database = new MetadataDatabase(':memory:'); const target = new FakeTarget(); const key = randomUUID(); const requestId = randomUUID();
  database.setSetting('workspace_operation:' + key, JSON.stringify({ id: requestId, createdAt: Date.now() - 31 * 24 * 60 * 60_000, input: JSON.stringify({ fingerprint: target.fingerprint, path: input.path, label: input.label }), state: 'ready', result: { workspaceId: result.workspaceId, tabId: result.tabId, terminalId: result.terminalId } }));
  const manager = new RuntimeManager(database, [target]);
  try {
    expect(() => manager.acceptCreateOperation('local', 'workspace', key, input)).toThrow('legacy_operation_ownership_ambiguous');
    const compact = JSON.parse(database.getSetting('workspace_operation:' + key)!);
    expect(compact.input).toBeUndefined();
    expect(compact.inputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(database.createOperations()).toHaveLength(0);
  } finally { database.close(); }
});

it('fails closed for legacy creates regardless of account or endpoint kind', () => {
  const database = new MetadataDatabase(':memory:'); const target = new FakeTarget(); const key = randomUUID();
  const manager = new RuntimeManager(database, [target]);
  database.setSetting('allowed_account', 'remote-account');
  database.setSetting('workspace_operation:' + key, JSON.stringify({ id: randomUUID(), input: JSON.stringify({ fingerprint: target.fingerprint, path: input.path, label: input.label }), state: 'ready', result }));
  expect(() => manager.acceptCreateOperation('local', 'workspace', key, input)).toThrow('legacy_operation_ownership_ambiguous');
  database.deleteSetting('workspace_operation:' + key);
  database.deleteSetting('allowed_account');
  const terminalKey = randomUUID(); const terminalRequestId = randomUUID();
  database.setSetting('workspace_operation:' + terminalKey, JSON.stringify({ id: terminalRequestId, input: JSON.stringify({ fingerprint: target.fingerprint, path: input.path, label: 'Terminal' }), state: 'running', result }));
  expect(() => manager.acceptCreateOperation('local', 'terminal', terminalKey, { machineId: 'fixture', path: input.path })).toThrow('legacy_operation_ownership_ambiguous');
  expect(JSON.parse(database.getSetting('workspace_operation:' + terminalKey)!)).toMatchObject({ id: terminalRequestId, state: 'unknown', error: 'legacy_create_outcome_uncertain' });
  expect(JSON.parse(database.getSetting('workspace_operation:' + terminalKey)!).input).toBeUndefined();
  expect(database.createOperations()).toHaveLength(0);
  database.close();
});

it('keeps empty native project lists and stable project identities across fresh snapshots', () => {
  const state = snapshot(); const first = nativeLocations('local', state);
  expect(first).toHaveLength(1); expect(nativeLocations('local', structuredClone(state))).toEqual(first);
  expect(nativeLocations('local', { ...state, workspaces: [] })).toEqual([]);
});
