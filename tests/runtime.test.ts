import { afterEach, expect, it, vi } from 'vitest';
import { TargetSupervisor } from '../src/server/runtime/supervisor';
import { MetadataDatabase } from '../src/server/storage/database';
import { RuntimeManager } from '../src/server/runtime/manager';
import { reconcile } from '../src/server/runtime/reconcile';
import { createRuntimeStore } from '../src/client/store';
import { FakeTarget } from './fixtures/target';
import type { Projection } from '../src/shared/runtime';

const cleanup: (() => void)[] = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); vi.useRealTimers(); });
const database = () => { const db = new MetadataDatabase(':memory:'); cleanup.push(() => db.close()); return db; };
it('serializes reads and performs an authoritative reread when an event occurs during a read', async () => {
  const target = new FakeTarget(); let finish!: () => void; let active = 0; let max = 0;
  target.readHook = async () => { ++active; max = Math.max(max, active); const state = structuredClone(target.state); if (target.reads === 1) await new Promise<void>((resolve) => { finish = resolve; }); --active; return state; };
  const publish = vi.fn(); const supervisor = new TargetSupervisor(target, publish, 0); cleanup.push(() => supervisor.stop());
  await supervisor.start(); await expect.poll(() => target.reads).toBe(1);
  target.state.tabs[0].label = 'Newest'; target.event!(); finish();
  await expect.poll(() => target.reads).toBe(2);
  expect(supervisor.snapshot!.tabs[0].label).toBe('Newest'); expect(max).toBe(1); expect(publish).toHaveBeenCalledTimes(2);
});
it('recovers events_lost by resubscribing before reading again, without replaying payloads', async () => {
  const target = new FakeTarget(); const supervisor = new TargetSupervisor(target, () => {}, 0); cleanup.push(() => supervisor.stop());
  await supervisor.start(); await expect.poll(() => supervisor.connected).toBe(true);
  target.lost!('events_lost'); expect(supervisor.connected).toBe(false);
  target.state.panes = [];
  await expect.poll(() => target.subscriptions).toBe(2);
  await expect.poll(() => supervisor.snapshot?.panes.length).toBe(0);
});
it('shares one upstream subscription among all manager consumers', async () => {
  const target = new FakeTarget(); const manager = new RuntimeManager(database(), [target]); cleanup.push(() => manager.close());
  manager.on('projection', () => {}); manager.on('projection', () => {}); manager.start();
  await expect.poll(() => manager.bootstrap().machines[0].connected).toBe(true); expect(target.subscriptions).toBe(1);
});
it('does not attach cold-restored terminal IDs by the old pane ID and follows moved terminal identity', () => {
  const target = new FakeTarget(); const db = database();
  const original = reconcile(db, target, target.state).threads[0];
  target.state.panes[0].pane_id = 'w2:p4'; target.state.panes[0].tab_id = 'w2:t3'; target.state.panes[0].workspace_id = 'w2';
  expect(reconcile(db, target, target.state).threads[0].panes[0].id).toBe('w2:p4');
  target.state.panes[0].terminal_id = 'term_new';
  const detached = reconcile(db, target, target.state).threads.find((thread) => thread.id === original.id)!;
  expect(detached.bindingState).toBe('detached'); expect(detached.panes).toEqual([]);
});
it('keeps machine-scoped identical native IDs separate and handles deletion and stale generations', () => {
  const db = database(); const first = new FakeTarget(); const second = new FakeTarget(); second.id = 'second';
  const a = reconcile(db, first, first.state); const b = reconcile(db, second, second.state);
  expect(a.threads[0].id).not.toBe(b.threads[0].id);
  const projection = (machineId: string, generation: string, revision: number, records = a): Projection => ({ machineId, generation, revision, freshAt: null, connected: true, ...records, layouts: [] });
  const store = createRuntimeStore({ projections: [projection(first.id, 'a', 1), projection(second.id, 'b', 1, b)], threads: [], projects: [], machines: [] });
  const row = store.getState().threads[a.threads[0].id];
  store.getState().install(projection(first.id, 'a', 2)); expect(store.getState().threads[row.id]).toBe(row);
  store.getState().install(projection(first.id, 'new', 1, { threads: [], projects: [] }));
  store.getState().install(projection(first.id, 'a', 50));
  expect(store.getState().threads[row.id]).toBeUndefined(); expect(store.getState().threads[b.threads[0].id]).toBeDefined();
});
it('does not use a late snapshot from a previous subscription after disconnect', async () => {
  const target = new FakeTarget(); let finish!: (value: typeof target.state) => void;
  target.readHook = () => new Promise((resolve) => { finish = resolve; });
  const supervisor = new TargetSupervisor(target, () => {}, 0); cleanup.push(() => supervisor.stop());
  await supervisor.start(); await expect.poll(() => target.reads).toBe(1);
  target.lost!('events_lost'); finish(target.state);
  await new Promise((resolve) => setTimeout(resolve, 10)); expect(supervisor.snapshot).toBeUndefined();
});
