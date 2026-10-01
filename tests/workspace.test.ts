import { expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { MetadataDatabase } from '../src/server/storage/database';
import { createWorkspace } from '../src/server/runtime/workspace';
import { FakeTarget, snapshot } from './fixtures/target';
import { nativeLocations } from '../src/server/transport/native-locations';

it('stores workspace intent before effect, returns repeated results and rejects changed payloads', async () => {
  const database = new MetadataDatabase(':memory:'); const key = randomUUID();
  const create = vi.fn(async () => {
    expect(JSON.parse(database.getSetting('workspace_operation:' + key)!)).toMatchObject({ state: 'unknown' });
    return { workspaceId: 'w1', tabId: 'w1:t1', terminalId: 'term_fixture' };
  });
  const target = Object.assign(new FakeTarget(), { createWorkspace: create });
  try {
    const result = await createWorkspace(database, target, key, '/project', 'Project');
    expect(await createWorkspace(database, target, key, '/project', 'Project')).toEqual(result);
    await expect(createWorkspace(database, target, key, '/other', 'Project')).rejects.toThrow('idempotency_conflict');
    expect(create).toHaveBeenCalledTimes(1);
  } finally { database.close(); }
});
it('never repeats an uncertain workspace creation', async () => {
  const database = new MetadataDatabase(':memory:'); const key = randomUUID();
  const create = vi.fn(async () => { throw new Error('rpc_timeout'); }); const target = Object.assign(new FakeTarget(), { createWorkspace: create });
  try {
    await expect(createWorkspace(database, target, key, '/project', 'Project')).rejects.toThrow('rpc_timeout');
    expect(await createWorkspace(database, target, key, '/project', 'Project')).toMatchObject({ state: 'unknown' });
    expect(create).toHaveBeenCalledTimes(1);
  } finally { database.close(); }
});
it('allows empty native project lists and keeps stable project identities across fresh snapshots', () => {
  const state = snapshot(); const first = nativeLocations('local', state);
  expect(first).toHaveLength(1); expect(nativeLocations('local', structuredClone(state))).toEqual(first);
  expect(nativeLocations('local', { ...state, workspaces: [] })).toEqual([]);
});
