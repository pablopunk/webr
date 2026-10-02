import { afterEach, expect, it } from 'vitest';
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
