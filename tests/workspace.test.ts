import { expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { MetadataDatabase } from '../src/server/storage/database';
import { createWorkspace } from '../src/server/runtime/workspace';
import { FakeTarget, snapshot } from './fixtures/target';
import { nativeLocations } from '../src/server/transport/native-locations';

it('stores workspace intent before effect, returns repeated results and rejects changed payloads', async () => {
  const database = new MetadataDatabase(':memory:'); const key = randomUUID();
  const expiredKey = randomUUID();
  database.setSetting('workspace_operation:' + expiredKey, JSON.stringify({ id: randomUUID(), state: 'ready', createdAt: Date.now() - 31 * 24 * 60 * 60_000 }));
  const create = vi.fn(async (_path: string, _label: string, _requestId: string) => {
    expect(JSON.parse(database.getSetting('workspace_operation:' + key)!)).toMatchObject({ state: 'unknown' });
    return { workspaceId: 'w1', tabId: 'w1:t1', paneId: 'w1:p1', terminalId: 'term_fixture' };
  });
  const target = Object.assign(new FakeTarget(), { createWorkspace: create });
  try {
    const result = await createWorkspace(database, target, key, '/project', 'Project');
    expect(database.getSetting('workspace_operation:' + expiredKey)).toBeUndefined();
    expect(await createWorkspace(database, target, key, '/project', 'Project')).toEqual(result);
    await expect(createWorkspace(database, target, key, '/other', 'Project')).rejects.toThrow('idempotency_conflict');
    expect(create).toHaveBeenCalledTimes(1);
  } finally { database.close(); }
});
it('retries an uncertain workspace creation with the original Herdr request ID', async () => {
  const database = new MetadataDatabase(':memory:'); const key = randomUUID();
  const result = { workspaceId: 'w2', tabId: 'w2:t1', paneId: 'w2:p1', terminalId: 'term_terminal' };
  const requestIds: string[] = [];
  const create = vi.fn(async (_path: string, _label: string, requestId: string) => {
    requestIds.push(requestId);
    if (requestIds.length === 1) throw new Error('rpc_timeout');
    return result;
  }); const target = Object.assign(new FakeTarget(), { createWorkspace: create });
  try {
    await expect(createWorkspace(database, target, key, '/project', 'Project')).rejects.toThrow('rpc_timeout');
    expect(await createWorkspace(database, target, key, '/project', 'Project')).toEqual(result);
    expect(create).toHaveBeenCalledTimes(2);
    expect(requestIds[0]).toBe(requestIds[1]);
    expect(JSON.parse(database.getSetting('workspace_operation:' + key)!)).toMatchObject({ state: 'ready', result });
  } finally { database.close(); }
});
it('upgrades a saved workspace result that predates root-pane IDs', async () => {
  const database = new MetadataDatabase(':memory:'); const key = randomUUID(); const requestId = randomUUID();
  const target = new FakeTarget();
  const input = JSON.stringify({ fingerprint: target.fingerprint, path: '/project', label: 'Terminal' });
  const result = { workspaceId: 'w2', tabId: 'w2:t1', paneId: 'w2:p1', terminalId: 'term_terminal' };
  database.setSetting('workspace_operation:' + key, JSON.stringify({ id: requestId, input, state: 'ready', result: { workspaceId: 'w2', tabId: 'w2:t1', terminalId: 'term_terminal' } }));
  const create = vi.fn(async (_path: string, _label: string, actualRequestId: string) => { expect(actualRequestId).toBe(requestId); return result; });
  Object.assign(target, { createWorkspace: create });
  try {
    expect(await createWorkspace(database, target, key, '/project', 'Terminal')).toEqual(result);
    expect(create).toHaveBeenCalledOnce();
    expect(JSON.parse(database.getSetting('workspace_operation:' + key)!)).toMatchObject({ state: 'ready', result });
  } finally { database.close(); }
});
it('allows empty native project lists and keeps stable project identities across fresh snapshots', () => {
  const state = snapshot(); const first = nativeLocations('local', state);
  expect(first).toHaveLength(1); expect(nativeLocations('local', structuredClone(state))).toEqual(first);
  expect(nativeLocations('local', { ...state, workspaces: [] })).toEqual([]);
});
