import { afterEach, expect, it, vi } from 'vitest';
import { TargetSupervisor } from '../src/server/runtime/supervisor';
import { MetadataDatabase } from '../src/server/storage/database';
import { RuntimeManager } from '../src/server/runtime/manager';
import { reconcile } from '../src/server/runtime/reconcile';
import { createRuntimeStore } from '../src/client/store';
import { FakeTarget } from './fixtures/target';
import type { Projection } from '../src/shared/runtime';

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.useRealTimers(); vi.restoreAllMocks(); });
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
  vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0.5);
  const target = new FakeTarget(); const supervisor = new TargetSupervisor(target, () => {}, 0); cleanup.push(() => supervisor.stop());
  const order: string[] = []; const subscribe = target.subscribe.bind(target);
  target.subscribe = async (...args) => { order.push('subscribe'); return subscribe(...args); };
  target.readHook = async () => { order.push('snapshot'); return structuredClone(target.state); };
  await supervisor.start(); await vi.advanceTimersByTimeAsync(10); expect(supervisor.connected).toBe(true);
  const subscriptions = target.subscriptions; order.length = 0;
  target.lost!('events_lost'); expect(supervisor.connected).toBe(false);
  target.state.panes = [];
  await vi.advanceTimersByTimeAsync(999); expect(supervisor.connected).toBe(false); expect(target.subscriptions).toBe(subscriptions);
  await vi.advanceTimersByTimeAsync(1); expect(order[0]).toBe('subscribe');
  await vi.advanceTimersByTimeAsync(1); expect(supervisor.connected).toBe(true); expect(order.indexOf('snapshot')).toBeGreaterThan(0);
  expect(target.activeSubscriptions).toBe(1);
  expect(supervisor.snapshot?.panes.length).toBe(0);
});
it('shares one upstream subscription among all manager consumers', async () => {
  const target = new FakeTarget(); const manager = new RuntimeManager(database(), [target]); cleanup.push(() => manager.close());
  manager.on('projection', () => {}); manager.on('projection', () => {}); manager.start();
  await expect.poll(() => manager.bootstrap().machines[0].connected).toBe(true); expect(target.activeSubscriptions).toBe(1);
});
it('keeps same-tab terminal lineage when a pane ID changes but never guesses cold-restore identity', () => {
  const target = new FakeTarget(); const db = database();
  const original = reconcile(db, target, target.state).threads[0];
  target.state.panes[0].pane_id = 'w2:p4';
  expect(reconcile(db, target, target.state).threads[0].panes[0].id).toBe('w2:p4');
  target.state.panes[0].terminal_id = 'term_new';
  const detached = reconcile(db, target, target.state).threads.find((thread) => thread.id === original.id)!;
  expect(detached.bindingState).toBe('detached'); expect(detached.panes).toEqual([]);
});
it('uses the agent pane title instead of a numeric tab label and updates an existing thread', () => {
  const target = new FakeTarget(); const db = database();
  target.state.tabs[0].label = '1';
  target.state.panes[0].agent = 'claude';
  target.state.panes[0].terminal_title_stripped = 'Adobe issue';
  const first = reconcile(db, target, target.state).threads[0];
  expect(first.title).toBe('Adobe issue');

  db.saveThread({ ...first, title: '1', panes: [] }, [target.state.panes[0].terminal_id], target.state.tabs[0].tab_id);
  expect(reconcile(db, target, target.state).threads[0]).toMatchObject({ id: first.id, title: 'Adobe issue' });
  target.state.panes[0].terminal_title_stripped = 'Another issue';
  expect(reconcile(db, target, target.state).threads[0].title).toBe('Another issue');
  target.state.tabs[0].label = 'My custom tab';
  expect(reconcile(db, target, target.state).threads[0].title).toBe('My custom tab');
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
it('invalidates absent runtime on gateway loss without treating enabled profiles as connected', () => {
  const db = database(); const target = new FakeTarget(); const records = reconcile(db, target, target.state);
  const projection: Projection = { machineId: target.id, generation: 'one', revision: 1, freshAt: new Date().toISOString(), connected: true, ...records, layouts: [] };
  const store = createRuntimeStore({ projections: [projection], machines: [], threads: [], projects: [] });
  store.getState().connection(true); store.getState().connection(false); store.getState().connection(true);
  expect(store.getState().projections[target.id].connected).toBe(false); expect(store.getState().threads[records.threads[0].id].panes).toEqual([]);
  store.getState().install(projection); expect(store.getState().projections[target.id].connected).toBe(true); expect(store.getState().threads[records.threads[0].id].bindingState).toBe('attached');
});
it('archives a thread out of the list and deletes archived threads together with their Herdr tab', async () => {
  const target = new FakeTarget(); const manager = new RuntimeManager(database(), [target]); cleanup.push(() => manager.close()); manager.start();
  await expect.poll(() => manager.bootstrap().threads.length).toBe(1);
  const thread = manager.bootstrap().threads[0];
  manager.archive('fixture', thread.id, true);
  expect(manager.bootstrap().threads[0].archivedAt).toBeTypeOf('string');
  expect(await manager.deleteArchived()).toEqual({ deleted: 1, failed: [] });
  expect(target.effects).toEqual(['discard:w1:t1']); expect(manager.database.threadRows('fixture')).toEqual([]);
  await expect(manager.deleteThread('fixture', thread.id)).rejects.toThrow('thread_not_found');
});
it('opens a terminal split once, then only hides and shows it, and closes it through Herdr', async () => {
  const target = new FakeTarget(); target.state.panes[0].agent = 'claude'; const manager = new RuntimeManager(database(), [target]); cleanup.push(() => manager.close()); manager.start();
  await expect.poll(() => manager.bootstrap().threads.length).toBe(1);
  const thread = manager.bootstrap().threads[0];
  expect(await manager.toggleTerminal('fixture', thread.id, 'right')).toEqual({ paneId: 'w1:p1s', hidden: false });
  expect(manager.bootstrap().threads[0].panes.map((pane) => pane.kind)).toEqual(['agent', 'shell']);
  expect(await manager.toggleTerminal('fixture', thread.id, 'right')).toEqual({ paneId: 'w1:p1s', hidden: true });
  expect(manager.bootstrap().threads[0].terminalHidden).toBe(true);
  expect(await manager.toggleTerminal('fixture', thread.id, 'down')).toEqual({ paneId: 'w1:p1s', hidden: false });
  await manager.closeTerminal('fixture', thread.id);
  expect(target.effects).toEqual(['split:right', 'close:w1:p1s']); expect(manager.bootstrap().threads[0].panes.map((pane) => pane.kind)).toEqual(['agent']);
});
