import { afterEach, expect, it, vi } from 'vitest';
import { MetadataDatabase } from '../src/server/storage/database';
import { createHost } from '../src/server/host';
import { RuntimeManager } from '../src/server/runtime/manager';
import { FakeTarget } from './fixtures/target';

const cleanups: (() => Promise<unknown> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const origin = 'http://localhost:4321';
const headers = { host: 'localhost:4321', origin };

async function hostWithoutWorktreeSupport() {
  const database = new MetadataDatabase(':memory:'); cleanups.push(() => database.close());
  const manager = new RuntimeManager(database, [new FakeTarget()]);
  const app = await createHost(manager, origin); cleanups.push(() => app.close());
  manager.start(); await expect.poll(() => manager.bootstrap().machines[0].connected).toBe(true);
  return app;
}

it('registers the worktree routes at the top level so they answer before any workspace is created', async () => {
  const app = await hostWithoutWorktreeSupport();
  const list = await app.inject({ url: '/api/worktrees?machineId=local&projectId=p', headers });
  const open = await app.inject({ method: 'POST', url: '/api/worktrees/open', headers: { ...headers, 'Idempotency-Key': '55555555-5555-4555-8555-555555555555' }, payload: { machineId: 'local', projectId: 'p', path: '/x' } });
  for (const response of [list, open]) { expect(response.statusCode).not.toBe(404); expect(response.json()).toEqual({ error: 'machine_disconnected' }); }
});

it('routes workspace creation through the connected runtime manager', async () => {
  const database = new MetadataDatabase(':memory:'); cleanups.push(() => database.close());
  const result = { workspaceId: 'w2', tabId: 'w2:t1', paneId: 'w2:p1', terminalId: 'term_new' };
  const createWorkspace = vi.fn(async (_path: string, _label: string, _requestId: string) => result);
  const target = Object.assign(new FakeTarget(), { createWorkspace });
  const manager = new RuntimeManager(database, [target]); cleanups.push(() => manager.close());
  const app = await createHost(manager, origin); cleanups.push(() => app.close());
  manager.start(); await expect.poll(() => manager.bootstrap().machines[0].connected).toBe(true);
  const response = await app.inject({
    method: 'POST', url: '/api/workspaces', headers: { ...headers, 'idempotency-key': '00000000-0000-4000-8000-000000000001' },
    payload: { machineId: target.id, path: '/project', label: 'Project' },
  });
  expect(response.statusCode).toBe(202);
  const accepted = response.json();
  expect(accepted).toMatchObject({ operationId: expect.any(String), kind: 'workspace', state: 'pending', step: 'validate' });
  await expect.poll(() => manager.database.createOperation(accepted.operationId)?.state).toBe('ready');
  const status = await app.inject({ url: accepted.statusUrl, headers });
  expect(status.json()).toMatchObject({ operationId: accepted.operationId, kind: 'workspace', state: 'ready', result });
  expect(createWorkspace).toHaveBeenCalledOnce();
});

it('accepts worktree opens before native completion and never replays an uncertain request', async () => {
  const database = new MetadataDatabase(':memory:'); cleanups.push(() => database.close());
  const target = new FakeTarget(); target.writable = false;
  let release!: () => void; let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const openWorktree = vi.fn(async () => { entered(); await gate; });
  Object.assign(target, {
    worktrees: async () => [{ path: '/fixture', branch: 'main', label: 'Fixture', is_bare: false, is_prunable: false }],
    openWorktree,
  });
  const manager = new RuntimeManager(database, [target]); cleanups.push(() => manager.close());
  const app = await createHost(manager, origin); cleanups.push(() => app.close());
  cleanups.push(() => release());
  manager.start(); await expect.poll(() => manager.bootstrap().machines[0].connected).toBe(true);
  const key = '44444444-4444-4444-8444-444444444444';
  const payload = { machineId: target.id, projectId: 'fixture:project', path: '/fixture' };
  const post = (value: typeof payload) => app.inject({ method: 'POST', url: '/api/worktrees/open', headers: { ...headers, 'Idempotency-Key': key }, payload: value });

  const first = await post(payload);
  expect(first.statusCode).toBe(202);
  const accepted = first.json();
  expect(accepted).toMatchObject({ operationId: expect.any(String), kind: 'worktree', state: 'pending', statusUrl: `/api/operations/${accepted.operationId}` });
  await started;
  expect(database.createOperation(accepted.operationId)).toMatchObject({ state: 'running', step: 'open' });
  manager.supervisors.get(target.id)!.stop();

  const duplicate = await post(payload);
  expect(duplicate.statusCode).toBe(202);
  expect(duplicate.json().operationId).toBe(accepted.operationId);
  expect((await app.inject({ url: accepted.statusUrl, headers })).json()).toMatchObject({ operationId: accepted.operationId, kind: 'worktree', state: 'running' });
  const conflict = await post({ ...payload, path: '/different' });
  expect(conflict.statusCode).toBe(409);
  expect(conflict.json()).toEqual({ error: 'idempotency_conflict' });
  expect(openWorktree).toHaveBeenCalledOnce();

  release();
  await expect.poll(() => database.createOperation(accepted.operationId)?.state).toBe('unknown');
  expect(openWorktree).toHaveBeenCalledOnce();
});
