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
it('keeps same-tab terminal lineage when a pane ID or terminal ID changes after a Herdr restart', () => {
  const target = new FakeTarget(); const db = database();
  const original = reconcile(db, target, target.state).threads[0];
  target.state.panes[0].pane_id = 'w2:p4';
  expect(reconcile(db, target, target.state).threads[0].panes[0].id).toBe('w2:p4');
  target.state.panes[0].terminal_id = 'term_new';
  const detached = reconcile(db, target, target.state).threads.find((thread) => thread.id === original.id)!;
  expect(detached.bindingState).toBe('attached'); expect(detached.panes[0].terminalId).toBe('term_new');
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
  const store = createRuntimeStore({ projections: [projection(first.id, 'a', 1), projection(second.id, 'b', 1, b)], threads: [], projects: [], machines: [], recoveryScope: 'fixture' });
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
it('marks runtime stale on gateway loss but keeps the last known threads listed', () => {
  const db = database(); const target = new FakeTarget(); const records = reconcile(db, target, target.state);
  const projection: Projection = { machineId: target.id, generation: 'one', revision: 1, freshAt: new Date().toISOString(), connected: true, ...records, layouts: [] };
  const store = createRuntimeStore({ projections: [projection], machines: [], threads: [], projects: [], recoveryScope: 'fixture' });
  store.getState().connection(true); store.getState().connection(false); store.getState().connection(true);
  expect(store.getState().projections[target.id].connected).toBe(false); expect(store.getState().threads[records.threads[0].id]).toMatchObject({ bindingState: 'detached', status: 'unknown', panes: records.threads[0].panes });
  store.getState().install(projection); expect(store.getState().projections[target.id].connected).toBe(true); expect(store.getState().threads[records.threads[0].id].bindingState).toBe('attached');
});
it('archives a thread out of the list and deletes archived threads together with their Herdr tab', async () => {
  const target = new FakeTarget(); const manager = new RuntimeManager(database(), [target]); cleanup.push(() => manager.close()); manager.start();
  await expect.poll(() => manager.bootstrap().threads.length).toBe(1);
  const thread = manager.bootstrap().threads[0];
  manager.archive('fixture', thread.id, true);
  expect(manager.bootstrap().threads[0].archivedAt).toBeTypeOf('string');
  expect(await manager.deleteArchived()).toEqual({ deleted: 1, orphanTabsDeleted: 0, failed: [], skippedMachines: [] });
  expect(target.effects).toEqual(['discard:w1:t1']); expect(manager.database.threadRows('fixture')).toEqual([]);
  await expect(manager.deleteThread('fixture', thread.id)).rejects.toThrow('thread_not_found');
});
it('deletes untracked terminal tabs and their agents while preserving live thread tabs', async () => {
  const target = new FakeTarget();
  const activePane = target.state.panes[0];
  target.state.tabs.push({ tab_id: 'w1:t2', workspace_id: 'w1', label: 'Active thread' });
  target.state.panes.push({ ...activePane, pane_id: 'w1:p2', terminal_id: 'term_active', tab_id: 'w1:t2', agent: 'opencode', focused: false });
  target.state.layouts.push({ workspace_id: 'w1', tab_id: 'w1:t2', area: { x: 0, y: 0, width: 80, height: 24 }, panes: [{ pane_id: 'w1:p2', rect: { x: 0, y: 0, width: 80, height: 24 } }] });
  target.state.tabs.push({ tab_id: 'w1:t3', workspace_id: 'w1', label: 'Orphan terminal' });
  target.state.panes.push({ ...activePane, pane_id: 'w1:p3', terminal_id: 'term_orphan', tab_id: 'w1:t3', agent: null, focused: false });
  target.state.layouts.push({ workspace_id: 'w1', tab_id: 'w1:t3', area: { x: 0, y: 0, width: 80, height: 24 }, panes: [{ pane_id: 'w1:p3', rect: { x: 0, y: 0, width: 80, height: 24 } }] });
  target.state.agents.push({ terminal_id: 'term_orphan' });
  const manager = new RuntimeManager(database(), [target]); cleanup.push(() => manager.close()); manager.start();
  await expect.poll(() => manager.bootstrap().threads.length).toBe(2);
  const archived = manager.bootstrap().threads.find((thread) => thread.tabId === 'w1:t1')!;
  manager.archive('fixture', archived.id, true);

  expect(await manager.deleteArchived()).toEqual({ deleted: 1, orphanTabsDeleted: 1, failed: [], skippedMachines: [] });
  expect(target.state.tabs.map((tab) => tab.tab_id)).toEqual(['w1:t2']);
  expect(target.state.panes.map((pane) => pane.terminal_id)).toEqual(['term_active']);
  expect(target.state.agents).toEqual([]);
  expect(target.discards).toEqual([{ tabId: 'w1:t1', removeWorktree: false }, { tabId: 'w1:t3', removeWorktree: false }]);
  expect(manager.database.threadRows('fixture').map((row) => row.alias)).toEqual(['w1:t2']);
});
it('reports an orphan terminal that Herdr could not close', async () => {
  const target = new FakeTarget();
  const pane = target.state.panes[0];
  target.state.tabs.push({ tab_id: 'w1:t2', workspace_id: 'w1', label: 'Orphan terminal' });
  target.state.panes.push({ ...pane, pane_id: 'w1:p2', terminal_id: 'term_orphan', tab_id: 'w1:t2', agent: null, focused: false });
  target.state.layouts.push({ workspace_id: 'w1', tab_id: 'w1:t2', area: { x: 0, y: 0, width: 80, height: 24 }, panes: [{ pane_id: 'w1:p2', rect: { x: 0, y: 0, width: 80, height: 24 } }] });
  const manager = new RuntimeManager(database(), [target]); cleanup.push(() => manager.close()); manager.start();
  await expect.poll(() => manager.bootstrap().threads.length).toBe(1);
  target.failure = 'discard:w1:t2:before';

  expect(await manager.deleteArchived()).toEqual({ deleted: 0, orphanTabsDeleted: 0, failed: ['fixture:w1:t2'], skippedMachines: [] });
  expect(target.state.tabs.map((tab) => tab.tab_id)).toContain('w1:t2');
});
it('opens terminals after the focused pane and keeps that order in the thread', async () => {
  const target = new FakeTarget(); target.state.panes[0].agent = 'claude'; const manager = new RuntimeManager(database(), [target]); cleanup.push(() => manager.close()); manager.start();
  await expect.poll(() => manager.bootstrap().threads.length).toBe(1);
  const thread = manager.bootstrap().threads[0];
  expect(await manager.openTerminal('fixture', thread.id, 'w1:p1')).toEqual({ paneId: 'w1:p1s1' });
  expect(await manager.openTerminal('fixture', thread.id, 'w1:p1')).toEqual({ paneId: 'w1:p1s2' });
  expect(manager.bootstrap().threads[0].panes.map((pane) => pane.id)).toEqual(['w1:p1', 'w1:p1s2', 'w1:p1s1']);
  expect(target.effects).toEqual(['split:right', 'split:right']);
});
it('closes only terminal panes and asks the client to confirm while a process runs', async () => {
  const target = new FakeTarget(); target.state.panes[0].agent = 'claude'; const manager = new RuntimeManager(database(), [target]); cleanup.push(() => manager.close()); manager.start();
  await expect.poll(() => manager.bootstrap().threads.length).toBe(1);
  const thread = manager.bootstrap().threads[0];
  const { paneId } = await manager.openTerminal('fixture', thread.id, 'w1:p1');
  expect(await manager.closePane('fixture', thread.id, 'w1:p1', true)).toEqual({ closed: false, busy: false });
  target.busyPanes.add(paneId);
  expect(await manager.closePane('fixture', thread.id, paneId, false)).toEqual({ closed: false, busy: true });
  expect(await manager.closePane('fixture', thread.id, paneId, true)).toEqual({ closed: true, busy: false });
  expect(target.effects).toEqual(['split:right', `close:${paneId}`]); expect(manager.bootstrap().threads[0].panes.map((pane) => pane.kind)).toEqual(['agent']);
});
it('adds a machine found after start and connects it at once', async () => {
  const manager = new RuntimeManager(database(), []); cleanup.push(() => manager.close()); manager.start();
  manager.addTarget(new FakeTarget());
  await expect.poll(() => manager.bootstrap().machines.map((machine) => [machine.id, machine.connected])).toEqual([['fixture', true]]);
});
it('acknowledges title metadata before native sync and cancels unsent values on clear', async () => {
  const db = database(); const target = new FakeTarget();
  let finishFirst!: () => void;
  const firstEffect = new Promise<void>((resolve) => { finishFirst = resolve; });
  const calls: string[] = [];
  Object.assign(target, { renameTab: async (_tabId: string, title: string, _renameWorkspace: boolean) => {
    calls.push(title);
    if (title === 'First') await firstEffect;
    target.state.tabs[0].label = title;
    target.event?.();
  } });
  const manager = new RuntimeManager(db, [target]); cleanup.push(() => manager.close()); manager.start();
  await expect.poll(() => manager.bootstrap().threads.length).toBe(1);
  const threadId = manager.bootstrap().threads[0].id;
  const first = manager.renameThread(target.id, threadId, ' First ');
  expect(first).toMatchObject({ metadataVersion: 1, title: 'First', metadata: { titleOverride: 'First', archivedAt: null } });
  expect(manager.bootstrap().threads[0]).toMatchObject({ metadataVersion: 1, title: 'Fixture tab', titleOverride: 'First', titleSync: { version: 1, state: 'pending' } });
  expect(db.threadRows(target.id)[0].metadata.title).toBe('Fixture tab');
  await expect.poll(() => calls).toEqual(['First']);
  expect(db.threadRows(target.id)[0].metadata.titleSync).toEqual({ version: 1, state: 'pending' });

  const second = manager.renameThread(target.id, threadId, 'Second');
  expect(second.metadataVersion).toBe(2);
  const cleared = manager.renameThread(target.id, threadId, null);
  expect(cleared).toMatchObject({ metadataVersion: 3, metadata: { titleOverride: null }, title: 'Fixture tab' });
  expect(db.threadRows(target.id)[0].metadata.titleSync).toEqual({ version: 3, state: 'unknown' });

  finishFirst();
  await expect.poll(() => manager.bootstrap().threads[0].title).toBe('First');
  expect(calls).toEqual(['First']);
  expect(db.threadRows(target.id)[0].metadata.titleOverride).toBeUndefined();
  expect(db.threadRows(target.id)[0].metadata.titleSync).toEqual({ version: 3, state: 'unknown' });
});
it('keeps native title separate from overrides in disconnected projections without a snapshot', () => {
  const db = database(); const target = new FakeTarget();
  const saved = reconcile(db, target, target.state).threads[0];
  const manager = new RuntimeManager(db, [target]); cleanup.push(() => manager.close());
  expect(manager.bootstrap().projections[0].connected).toBe(false);
  expect(manager.bootstrap().threads[0]).toMatchObject({ id: saved.id, title: 'Fixture tab' });

  manager.renameThread(target.id, saved.id, 'Disconnected override');
  expect(manager.bootstrap().threads[0]).toMatchObject({ title: 'Fixture tab', titleOverride: 'Disconnected override' });
});
it('keeps metadata versions and canonical user fields in disconnected projections', async () => {
  const db = database(); const target = new FakeTarget(); const manager = new RuntimeManager(db, [target]); cleanup.push(() => manager.close()); manager.start();
  await expect.poll(() => manager.bootstrap().threads.length).toBe(1);
  const threadId = manager.bootstrap().threads[0].id;
  const response = manager.renameThread(target.id, threadId, 'Disconnected title');
  target.lost!('events_lost');
  await expect.poll(() => manager.bootstrap().projections[0].connected).toBe(false);
  expect(manager.bootstrap().threads[0]).toMatchObject({ title: 'Fixture tab', metadataVersion: response.metadataVersion, titleOverride: 'Disconnected title', titleSync: { version: response.metadataVersion, state: 'unknown' } });
});
it('acknowledges native rename failure, timeout, and interrupted restart state', async () => {
  const db = database(); const target = new FakeTarget();
  Object.assign(target, { renameTab: async () => { throw new Error('native_failure'); } });
  const manager = new RuntimeManager(db, [target]); cleanup.push(() => manager.close()); manager.start();
  await expect.poll(() => manager.bootstrap().threads.length).toBe(1);
  const threadId = manager.bootstrap().threads[0].id;
  const response = manager.renameThread(target.id, threadId, 'Failure is best effort');
  expect(response.metadataVersion).toBe(1);
  await expect.poll(() => db.threadRows(target.id)[0].metadata.titleSync.state).toBe('failed');

  const hanging = new FakeTarget(); let attempts = 0;
  Object.assign(hanging, { renameTab: async () => { ++attempts; return new Promise<void>(() => {}); } });
  const secondManager = new RuntimeManager(db, [hanging]);
  let secondClosed = false;
  const closeSecond = async () => { if (!secondClosed) { secondClosed = true; await secondManager.close(); } };
  cleanup.push(closeSecond); secondManager.start();
  await expect.poll(() => secondManager.bootstrap().threads.length).toBe(1);
  const hangingThread = secondManager.bootstrap().threads[0].id;
  secondManager.renameThread(hanging.id, hangingThread, 'Timeout');
  await expect.poll(() => attempts).toBe(1);
  await new Promise((resolve) => setTimeout(resolve, 5100));
  expect(db.threadRows(hanging.id)[0].metadata.titleSync).toEqual({ version: 2, state: 'unknown' });
  await closeSecond();

  const restarted = new RuntimeManager(db, [new FakeTarget()]); cleanup.push(() => restarted.close()); restarted.start();
  await expect.poll(() => restarted.bootstrap().threads.length).toBe(1);
  expect(db.threadRows(hanging.id)[0].metadata.titleSync).toEqual({ version: 2, state: 'unknown' });
  expect(attempts).toBe(1);
});
