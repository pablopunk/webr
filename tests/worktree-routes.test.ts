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
  const open = await app.inject({ method: 'POST', url: '/api/worktrees/open', headers, payload: { machineId: 'local', projectId: 'p', path: '/x' } });
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
