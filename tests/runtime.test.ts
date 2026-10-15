import { afterEach, expect, it, vi } from 'vitest';
import { TargetSupervisor } from '../src/server/runtime/supervisor';
import { MetadataDatabase } from '../src/server/storage/database';
import { RuntimeManager } from '../src/server/runtime/manager';
import { reconcile } from '../src/server/runtime/reconcile';
import { createRuntimeStore } from '../src/client/store';
import { FakeTarget } from './fixtures/target';
import type { NativeSnapshot } from '../src/server/protocol/native';
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
it('permits an equal-revision reconnect baseline but never regresses revisions or retired generations', () => {
  const store = createRuntimeStore({ projections: [], machines: [], threads: [], projects: [], recoveryScope: 'fixture' });
  const projection = (generation: string, revision: number): Projection => ({ machineId: 'fixture', generation, revision, freshAt: new Date().toISOString(), connected: true, threads: [], projects: [], layouts: [] });
  const current = projection('g1', 5);
  store.getState().install(current); store.getState().connection(false);
  expect(store.getState().install(projection('g1', 4))).toBe(false);
  expect(store.getState().install(current)).toBe(true);
  expect(store.getState().install(projection('g1', 4))).toBe(false);
  expect(store.getState().install(projection('g2', 1))).toBe(true);
  expect(store.getState().install(projection('g1', 99))).toBe(false);
});

it('retains the last confirmed thread, tabs, panes, and layout on machine-only loss', async () => {
  const target = new FakeTarget(); const manager = new RuntimeManager(database(), [target]); cleanup.push(() => manager.close()); manager.start();
  await expect.poll(() => manager.bootstrap().projections[0]?.connected).toBe(true);
  const before = manager.bootstrap().projections[0];
  expect(before.threads[0].bindingState).toBe('attached');
  target.state.tabs = []; target.state.panes = []; target.state.layouts = [];
  target.lost!('events_lost');
  await expect.poll(() => manager.bootstrap().projections[0]?.connected).toBe(false);
  const stale = manager.bootstrap().projections[0];
  expect(stale).toMatchObject({ generation: before.generation, connected: false, freshAt: null });
  expect(stale.revision).toBeGreaterThan(before.revision);
  expect(stale.threads[0]).toMatchObject({ bindingState: 'attached', status: 'unknown', panes: before.threads[0].panes });
  expect(stale.availableTabs).toEqual(before.availableTabs);
  expect(stale.layouts).toEqual(before.layouts);
  expect(() => manager.binding(target.id, before.threads[0].id, before.threads[0].panes[0].terminalId!)).toThrow('machine_disconnected');
  expect(() => manager.terminalBinding(target.id, before.threads[0].panes[0].terminalId!, { tabId: before.threads[0].tabId })).toThrow('machine_disconnected');
  await expect(manager.openTerminal(target.id, before.threads[0].id, before.threads[0].panes[0].id)).rejects.toThrow('machine_disconnected');
});

it('detaches a missing resource only after a fresh machine snapshot confirms absence', async () => {
  const target = new FakeTarget(); const manager = new RuntimeManager(database(), [target]); cleanup.push(() => manager.close()); manager.start();
  await expect.poll(() => manager.bootstrap().projections[0]?.connected).toBe(true);
  target.state.tabs = []; target.state.panes = []; target.state.layouts = []; target.event!();
  await expect.poll(() => manager.bootstrap().projections[0]?.threads[0]?.bindingState).toBe('detached');
  const projection = manager.bootstrap().projections[0];
  expect(projection.connected).toBe(true); expect(projection.freshAt).toBeTruthy();
  expect(projection.threads[0]).toMatchObject({ bindingState: 'detached', status: 'unknown', panes: [] });
  expect(projection.availableTabs).toEqual([]); expect(projection.layouts).toEqual([]);
  manager.archive(target.id, projection.threads[0].id, true);
  expect(await manager.deleteArchived()).toEqual({ deleted: 1, orphanTabsDeleted: 0, failed: [], skippedMachines: [] });
  expect(target.effects).not.toContain('discard:w1:t1');
  expect(manager.database.threadRows(target.id)).toEqual([]);
});

it('fails closed when the newest native snapshot cannot be projected', async () => {
  const target = new FakeTarget(); const manager = new RuntimeManager(database(), [target]); cleanup.push(() => manager.close()); manager.start();
  await expect.poll(() => manager.bootstrap().projections[0]?.connected).toBe(true);
  const thread = manager.bootstrap().threads[0]; const terminalId = thread.panes[0].terminalId;
  const supervisor = manager.supervisors.get(target.id)!; const revision = supervisor.revision;
  target.readHook = async () => ({ ...structuredClone(target.state), workspaces: null } as unknown as NativeSnapshot);
  target.event!();
  await expect.poll(() => supervisor.revision).toBeGreaterThan(revision);
  expect(supervisor.connected).toBe(true);
  expect(manager.bootstrap().projections[0]).toMatchObject({ connected: false, freshAt: null, error: 'projection_failed' });
  expect(() => manager.binding(target.id, thread.id, terminalId!)).toThrow('machine_disconnected');
  target.readHook = undefined; target.event!();
  await expect.poll(() => { try { manager.binding(target.id, thread.id, terminalId!); return true; } catch { return false; } }).toBe(true);
});

it('does not delete stale detached metadata or clean tabs after machine loss', async () => {
  const target = new FakeTarget(); const db = database(); const manager = new RuntimeManager(db, [target]); cleanup.push(() => manager.close()); manager.start();
  await expect.poll(() => manager.bootstrap().threads.length).toBe(1);
  const thread = manager.bootstrap().threads[0]; manager.archive(target.id, thread.id, true);
  target.lost!('events_lost');
  await expect.poll(() => manager.bootstrap().projections[0]?.connected).toBe(false);
  await expect(manager.deleteThread(target.id, thread.id)).rejects.toThrow('machine_disconnected');
  await expect(manager.closeTab(target.id, thread.tabId, true)).rejects.toThrow('machine_disconnected');
  const result = await manager.deleteArchived();
  expect(result.deleted).toBe(0); expect(result.failed).toEqual([thread.id]); expect(result.skippedMachines).toContain(target.id);
  expect(db.threadRows(target.id).some((row) => row.id === thread.id)).toBe(true);
  expect(target.effects).not.toContain(`discard:${thread.tabId}`);
});

it('does not use a late snapshot from a previous subscription after disconnect', async () => {
  const target = new FakeTarget(); let finish!: (value: typeof target.state) => void;
  target.readHook = () => new Promise((resolve) => { finish = resolve; });
  const supervisor = new TargetSupervisor(target, () => {}, 0); cleanup.push(() => supervisor.stop());
  await supervisor.start(); await expect.poll(() => target.reads).toBe(1);
  target.lost!('events_lost'); finish(target.state);
  await new Promise((resolve) => setTimeout(resolve, 10)); expect(supervisor.snapshot).toBeUndefined();
});
it('marks gateway loss stale without changing machine connectivity or confirmed bindings', () => {
  const db = database(); const target = new FakeTarget(); const records = reconcile(db, target, target.state);
  const projection: Projection = { machineId: target.id, generation: 'one', revision: 1, freshAt: new Date().toISOString(), connected: true, ...records, layouts: [] };
  const store = createRuntimeStore({ projections: [projection], machines: [], threads: [], projects: [], recoveryScope: 'fixture' });
  store.getState().connection(true); store.getState().connection(false);
  expect(store.getState().connected).toBe(false);
  expect(store.getState().projections[target.id]).toMatchObject({ connected: true, freshAt: null });
  expect(store.getState().threads[records.threads[0].id]).toMatchObject({ bindingState: 'attached', status: 'unknown', panes: records.threads[0].panes });
  store.getState().connection(true); expect(store.getState().install(projection)).toBe(true);
  expect(store.getState().projections[target.id].freshAt).toBe(projection.freshAt);
  expect(store.getState().threads[records.threads[0].id].bindingState).toBe('attached');
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
it('serializes pane splits against terminal-pane close', async () => {
  const target = new FakeTarget(); target.state.panes[0].agent = 'claude'; const manager = new RuntimeManager(database(), [target]); cleanup.push(() => manager.close()); manager.start();
  await expect.poll(() => manager.bootstrap().threads.length).toBe(1);
  const thread = manager.bootstrap().threads[0]; const { paneId } = await manager.openTerminal('fixture', thread.id, 'w1:p1');
  let finishSplit!: () => void; let started!: () => void;
  const splitStarted = new Promise<void>((resolve) => { started = resolve; });
  const split = target.splitTerminal.bind(target);
  target.splitTerminal = async (afterPaneId, direction) => { started(); await new Promise<void>((resolve) => { finishSplit = resolve; }); return split(afterPaneId, direction); };
  const opening = manager.openTerminal('fixture', thread.id, paneId);
  await splitStarted;
  const closing = manager.closePane('fixture', thread.id, paneId, true);
  await Promise.resolve(); expect(target.effects).not.toContain(`close:${paneId}`);
  finishSplit();
  await expect(opening).resolves.toMatchObject({ paneId: expect.stringContaining(paneId) });
  await expect(closing).resolves.toEqual({ closed: true, busy: false });
  expect(target.effects.slice(-2)).toEqual(['split:right', `close:${paneId}`]);
});
it('serializes pane focus against terminal-pane close', async () => {
  const target = new FakeTarget(); target.state.panes[0].agent = 'claude'; const manager = new RuntimeManager(database(), [target]); cleanup.push(() => manager.close()); manager.start();
  await expect.poll(() => manager.bootstrap().threads.length).toBe(1);
  const thread = manager.bootstrap().threads[0]; const { paneId } = await manager.openTerminal(target.id, thread.id, 'w1:p1');
  let finishFocus!: () => void; let started!: () => void; const order: string[] = [];
  const focusStarted = new Promise<void>((resolve) => { started = resolve; });
  target.focusPane = async (id) => { order.push(`focus:${id}`); started(); await new Promise<void>((resolve) => { finishFocus = resolve; }); target.focused.push(id); };
  const close = target.closePane.bind(target);
  target.closePane = async (id) => { order.push(`close:${id}`); await close(id); };
  const focusing = manager.focusPane(target.id, thread.id, paneId); await focusStarted;
  const closing = manager.closePane(target.id, thread.id, paneId, true);
  await Promise.resolve(); expect(order).toEqual([`focus:${paneId}`]);
  finishFocus();
  await expect(focusing).resolves.toMatchObject({ focused: true });
  await expect(closing).resolves.toEqual({ closed: true, busy: false });
  expect(order).toEqual([`focus:${paneId}`, `close:${paneId}`]);
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
it('rechecks pane busy state inside the destructive mutation queue', async () => {
  const target = new FakeTarget(); target.state.panes[0].agent = 'claude'; const manager = new RuntimeManager(database(), [target]); cleanup.push(() => manager.close()); manager.start();
  await expect.poll(() => manager.bootstrap().threads.length).toBe(1);
  const thread = manager.bootstrap().threads[0]; const { paneId } = await manager.openTerminal('fixture', thread.id, 'w1:p1');
  let probes = 0; target.paneBusy = async () => ++probes > 1;
  expect(await manager.closePane('fixture', thread.id, paneId, false)).toEqual({ closed: false, busy: true });
  expect(probes).toBe(2); expect(target.effects).not.toContain(`close:${paneId}`);
});
it('does not close a pane after a fresh projection detaches its thread during the busy probe', async () => {
  const target = new FakeTarget(); target.state.panes[0].agent = 'claude'; const manager = new RuntimeManager(database(), [target]); cleanup.push(() => manager.close()); manager.start();
  await expect.poll(() => manager.bootstrap().threads.length).toBe(1);
  const thread = manager.bootstrap().threads[0]; const { paneId } = await manager.openTerminal('fixture', thread.id, 'w1:p1');
  let finishProbe!: (busy: boolean) => void; let started!: () => void;
  const probeStarted = new Promise<void>((resolve) => { started = resolve; });
  target.paneBusy = async () => { started(); return new Promise<boolean>((resolve) => { finishProbe = resolve; }); };
  const closing = manager.closePane('fixture', thread.id, paneId, false);
  await probeStarted;
  const row = manager.database.threadRows('fixture').find((item) => item.id === thread.id)!;
  manager.database.saveThread({ ...row.metadata, bindingFingerprint: 'retired-fingerprint' }, row.anchors, row.alias);
  target.event!();
  finishProbe(false);
  await expect(closing).rejects.toThrow('machine_disconnected');
  await expect.poll(() => manager.bootstrap().threads.find((item) => item.id === thread.id)?.bindingState).toBe('detached');
  expect(target.effects).not.toContain(`close:${paneId}`);
});
it('does not close a terminal tab adopted by a thread during the busy probe', async () => {
  const target = new FakeTarget(); const manager = new RuntimeManager(database(), [target]); cleanup.push(() => manager.close()); manager.start();
  await expect.poll(() => manager.bootstrap().threads.length).toBe(1);
  const thread = manager.bootstrap().threads[0];
  target.state.tabs.push({ tab_id: 'w1:t2', workspace_id: 'w1', label: 'Shell' });
  target.state.panes.push({ ...target.state.panes[0], pane_id: 'w1:p2', terminal_id: 'term_shell', tab_id: 'w1:t2', agent: null, focused: false });
  target.event!();
  await expect.poll(() => manager.bootstrap().projections[0]?.availableTabs?.some((tab) => tab.tabId === 'w1:t2')).toBe(true);
  let finishProbe!: (busy: boolean) => void; let started!: () => void;
  const probeStarted = new Promise<void>((resolve) => { started = resolve; });
  target.paneBusy = async () => { started(); return new Promise<boolean>((resolve) => { finishProbe = resolve; }); };
  const closing = manager.closeTab('fixture', 'w1:t2', false);
  await probeStarted;
  await manager.adopt('fixture', thread.id, ['term_shell']);
  await expect.poll(() => manager.bootstrap().threads.find((item) => item.id === thread.id)?.tabId).toBe('w1:t2');
  finishProbe(false);
  await expect(closing).rejects.toThrow('binding_conflict');
  expect(target.effects).not.toContain('discard:w1:t2');
});
it('rechecks tab pane busy state inside the destructive mutation queue', async () => {
  const target = new FakeTarget(); target.state.tabs.push({ tab_id: 'w1:t2', workspace_id: 'w1', label: 'Shell' });
  target.state.panes.push({ ...target.state.panes[0], pane_id: 'w1:p2', terminal_id: 'term_shell', tab_id: 'w1:t2', agent: null, focused: false });
  target.state.layouts.push({ workspace_id: 'w1', tab_id: 'w1:t2', area: { x: 0, y: 0, width: 80, height: 24 }, panes: [{ pane_id: 'w1:p2', rect: { x: 0, y: 0, width: 80, height: 24 } }] });
  const manager = new RuntimeManager(database(), [target]); cleanup.push(() => manager.close()); manager.start();
  await expect.poll(() => manager.bootstrap().projections[0]?.availableTabs?.some((tab) => tab.tabId === 'w1:t2')).toBe(true);
  let probes = 0; target.paneBusy = async () => ++probes > 1;
  expect(await manager.closeTab('fixture', 'w1:t2', false)).toEqual({ closed: false, busy: true });
  expect(probes).toBe(2); expect(target.effects).not.toContain('discard:w1:t2');
});
it('serializes adoption behind destructive tab close and rejects the closed snapshot', async () => {
  const target = new FakeTarget(); const manager = new RuntimeManager(database(), [target]); cleanup.push(() => manager.close()); manager.start();
  await expect.poll(() => manager.bootstrap().threads.length).toBe(1);
  const thread = manager.bootstrap().threads[0];
  target.state.tabs.push({ tab_id: 'w1:t2', workspace_id: 'w1', label: 'Shell' });
  target.state.panes.push({ ...target.state.panes[0], pane_id: 'w1:p2', terminal_id: 'term_shell', tab_id: 'w1:t2', agent: null, focused: false });
  target.event!();
  await expect.poll(() => manager.bootstrap().projections[0]?.availableTabs?.some((tab) => tab.tabId === 'w1:t2')).toBe(true);
  let finishDiscard!: () => void; let started!: () => void;
  const discardStarted = new Promise<void>((resolve) => { started = resolve; });
  const discard = target.discardTab.bind(target);
  target.discardTab = async (snapshot, tabId, removeWorktree) => {
    started();
    await new Promise<void>((resolve) => { finishDiscard = resolve; });
    await discard(snapshot, tabId, removeWorktree);
  };
  const closing = manager.closeTab('fixture', 'w1:t2', true);
  await discardStarted;
  let adoptionFinished = false;
  const adoption = manager.adopt('fixture', thread.id, ['term_shell']).finally(() => { adoptionFinished = true; });
  await Promise.resolve(); expect(adoptionFinished).toBe(false);
  finishDiscard();
  await expect(closing).resolves.toEqual({ closed: true, busy: false });
  await expect(adoption).rejects.toThrow('invalid_adoption');
  expect(target.effects).toContain('discard:w1:t2');
});
it('serializes worktree reopening against archived deletion', async () => {
  const target = new FakeTarget();
  let finishOpen!: () => void; let started!: () => void;
  const openStarted = new Promise<void>((resolve) => { started = resolve; });
  Object.assign(target, {
    worktrees: async () => [{ path: '/fixture', branch: 'main', label: 'Fixture', is_bare: false, is_prunable: false }],
    openWorktree: async () => { started(); await new Promise<void>((resolve) => { finishOpen = resolve; }); },
  });
  const manager = new RuntimeManager(database(), [target]); cleanup.push(() => manager.close()); manager.start();
  await expect.poll(() => manager.bootstrap().threads.length).toBe(1);
  const thread = manager.bootstrap().threads[0]; manager.archive(target.id, thread.id, true);
  const opening = manager.openWorktree(target.id, thread.projectId, '/fixture');
  await openStarted;
  const deleting = manager.deleteArchived();
  await Promise.resolve(); expect(target.effects).not.toContain(`discard:${thread.tabId}`);
  finishOpen();
  await expect(opening).resolves.toEqual({ id: thread.id });
  await expect(deleting).resolves.toEqual({ deleted: 0, orphanTabsDeleted: 0, failed: [thread.id], skippedMachines: [] });
  expect(target.effects).not.toContain(`discard:${thread.tabId}`);
});
it('serializes workspace creation behind destructive tab close', async () => {
  const target = new FakeTarget(); target.state.tabs.push({ tab_id: 'w1:t2', workspace_id: 'w1', label: 'Shell' });
  target.state.panes.push({ ...target.state.panes[0], pane_id: 'w1:p2', terminal_id: 'term_shell', tab_id: 'w1:t2', agent: null, focused: false });
  target.state.layouts.push({ workspace_id: 'w1', tab_id: 'w1:t2', area: { x: 0, y: 0, width: 80, height: 24 }, panes: [{ pane_id: 'w1:p2', rect: { x: 0, y: 0, width: 80, height: 24 } }] });
  let finishDiscard!: () => void; let started!: () => void;
  const discardStarted = new Promise<void>((resolve) => { started = resolve; });
  const discard = target.discardTab.bind(target);
  target.discardTab = async (snapshot, tabId, removeWorktree) => { started(); await new Promise<void>((resolve) => { finishDiscard = resolve; }); await discard(snapshot, tabId, removeWorktree); };
  const terminalResult = { workspaceId: 'w2', tabId: 'w2:t1', paneId: 'w2:p1', terminalId: 'term_terminal' };
  const workspaceResult = { workspaceId: 'w3', tabId: 'w3:t1', paneId: 'w3:p1', terminalId: 'term_project' };
  const create = vi.fn().mockResolvedValueOnce(terminalResult).mockResolvedValueOnce(workspaceResult);
  Object.assign(target, { createWorkspace: create });
  const manager = new RuntimeManager(database(), [target]); cleanup.push(() => manager.close()); manager.start();
  await expect.poll(() => manager.bootstrap().projections[0]?.availableTabs?.some((tab) => tab.tabId === 'w1:t2')).toBe(true);
  const closing = manager.closeTab(target.id, 'w1:t2', true); await discardStarted;
  const terminal = manager.acceptCreateOperation('local', 'terminal', '00000000-0000-4000-8000-000000000001', { machineId: target.id, path: '/terminal' });
  const workspace = manager.acceptCreateOperation('local', 'workspace', '00000000-0000-4000-8000-000000000002', { machineId: target.id, path: '/project', label: 'Project' });
  manager.startCreateOperation(terminal.envelope.operationId);
  manager.startCreateOperation(workspace.envelope.operationId);
  await Promise.resolve(); expect(create).not.toHaveBeenCalled();
  finishDiscard();
  await expect(closing).resolves.toEqual({ closed: true, busy: false });
  await expect.poll(() => manager.database.createOperation(terminal.envelope.operationId)).toMatchObject({ state: 'ready', result: terminalResult });
  await expect.poll(() => manager.database.createOperation(workspace.envelope.operationId)).toMatchObject({ state: 'ready', result: workspaceResult });
  expect(create).toHaveBeenCalledTimes(2);
});
it('prevents unarchiving a thread while its archived-tab deletion is in flight', async () => {
  const target = new FakeTarget(); target.state.panes[0].agent = 'claude'; const manager = new RuntimeManager(database(), [target]); cleanup.push(() => manager.close()); manager.start();
  await expect.poll(() => manager.bootstrap().threads.length).toBe(1);
  const thread = manager.bootstrap().threads[0]; manager.archive('fixture', thread.id, true);
  let finishDiscard!: () => void; let started!: () => void;
  const discardStarted = new Promise<void>((resolve) => { started = resolve; });
  const discard = target.discardTab.bind(target);
  target.discardTab = async (snapshot, tabId, removeWorktree) => {
    started();
    await new Promise<void>((resolve) => { finishDiscard = resolve; });
    await discard(snapshot, tabId, removeWorktree);
  };
  const deleting = manager.deleteArchived();
  await discardStarted;
  expect(() => manager.archive('fixture', thread.id, false)).toThrow('delete_in_progress');
  finishDiscard();
  await expect(deleting).resolves.toEqual({ deleted: 1, orphanTabsDeleted: 0, failed: [], skippedMachines: [] });
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
  await expect.poll(() => secondManager.bootstrap().projections[0]?.connected).toBe(true);
  await expect.poll(() => secondManager.bootstrap().threads[0]?.bindingState).toBe('attached');
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
it('serializes native title sync against destructive thread deletion', async () => {
  const target = new FakeTarget(); target.state.panes[0].agent = 'claude';
  let finishRename!: () => void; let started!: () => void; const order: string[] = [];
  const renameStarted = new Promise<void>((resolve) => { started = resolve; });
  Object.assign(target, { renameTab: async (_tabId: string, title: string) => { order.push('rename-start'); started(); await new Promise<void>((resolve) => { finishRename = resolve; }); target.state.tabs[0].label = title; order.push('rename-finish'); } });
  const discard = target.discardTab.bind(target);
  target.discardTab = async (snapshot, tabId, removeWorktree) => { order.push('discard'); await discard(snapshot, tabId, removeWorktree); };
  const manager = new RuntimeManager(database(), [target]); cleanup.push(() => manager.close()); manager.start();
  await expect.poll(() => manager.bootstrap().threads.length).toBe(1);
  const thread = manager.bootstrap().threads[0]; manager.renameThread(target.id, thread.id, 'New title');
  await renameStarted;
  const deleting = manager.deleteThread(target.id, thread.id);
  await Promise.resolve(); expect(order).toEqual(['rename-start']);
  finishRename();
  await expect(deleting).resolves.toBeUndefined();
  expect(order).toEqual(['rename-start', 'rename-finish', 'discard']);
});
it('revalidates the tab identity before a queued title sync', async () => {
  const target = new FakeTarget();
  target.state.tabs.push({ tab_id: 'w1:t2', workspace_id: 'w1', label: 'Shell' });
  target.state.panes.push({ ...target.state.panes[0], pane_id: 'w1:p2', terminal_id: 'term_shell', tab_id: 'w1:t2', agent: null, focused: false });
  target.state.layouts.push({ workspace_id: 'w1', tab_id: 'w1:t2', area: { x: 0, y: 0, width: 80, height: 24 }, panes: [{ pane_id: 'w1:p2', rect: { x: 0, y: 0, width: 80, height: 24 } }] });
  let finishCreate!: () => void; let started!: () => void;
  const createStarted = new Promise<void>((resolve) => { started = resolve; });
  const workspace = { workspaceId: 'w2', tabId: 'w2:t1', paneId: 'w2:p1', terminalId: 'term_workspace' };
  const renamed: string[] = [];
  Object.assign(target, {
    createWorkspace: async () => { started(); await new Promise<void>((resolve) => { finishCreate = resolve; }); return workspace; },
    renameTab: async (tabId: string) => { renamed.push(tabId); },
  });
  const manager = new RuntimeManager(database(), [target]); cleanup.push(() => manager.close()); manager.start();
  await expect.poll(() => manager.bootstrap().threads.length).toBe(1);
  const thread = manager.bootstrap().threads[0];
  const creating = manager.acceptCreateOperation('local', 'workspace', '00000000-0000-4000-8000-000000000003', { machineId: target.id, path: '/workspace', label: 'Workspace' });
  manager.startCreateOperation(creating.envelope.operationId);
  await createStarted;
  manager.renameThread(target.id, thread.id, 'New title');
  const adoption = manager.adopt(target.id, thread.id, ['term_shell']);
  finishCreate();
  await expect.poll(() => manager.database.createOperation(creating.envelope.operationId)).toMatchObject({ state: 'ready', result: workspace });
  await expect(adoption).resolves.toBeUndefined();
  await expect.poll(() => manager.database.threadRows(target.id)[0]?.metadata.titleSync?.state).toBe('failed');
  expect(manager.bootstrap().threads.find((item) => item.id === thread.id)?.tabId).toBe('w1:t2');
  expect(renamed).toEqual([]);
});
it('revalidates worktree ownership before a queued title sync', async () => {
  const target = new FakeTarget(); let finishCreate!: () => void; let started!: () => void;
  const createStarted = new Promise<void>((resolve) => { started = resolve; });
  const workspace = { workspaceId: 'w2', tabId: 'w2:t1', paneId: 'w2:p1', terminalId: 'term_workspace' };
  const renameTab = vi.fn(async () => {});
  Object.assign(target, { createWorkspace: async () => { started(); await new Promise<void>((resolve) => { finishCreate = resolve; }); return workspace; }, renameTab });
  const manager = new RuntimeManager(database(), [target]); cleanup.push(() => manager.close()); manager.start();
  await expect.poll(() => manager.bootstrap().threads.length).toBe(1);
  const thread = manager.bootstrap().threads[0];
  const creating = manager.acceptCreateOperation('local', 'workspace', '00000000-0000-4000-8000-000000000004', { machineId: target.id, path: '/workspace', label: 'Workspace' });
  manager.startCreateOperation(creating.envelope.operationId);
  await createStarted;
  manager.renameThread(target.id, thread.id, 'New title');
  const row = manager.database.threadRows(target.id).find((item) => item.id === thread.id)!;
  manager.database.saveThread({ ...row.metadata, ownsWorktree: true }, row.anchors, row.alias);
  target.event!();
  await expect.poll(() => manager.bootstrap().threads.find((item) => item.id === thread.id)?.ownsWorktree).toBe(true);
  finishCreate();
  await expect.poll(() => manager.database.createOperation(creating.envelope.operationId)).toMatchObject({ state: 'ready', result: workspace });
  await expect.poll(() => manager.database.threadRows(target.id)[0]?.metadata.titleSync?.state).toBe('failed');
  expect(renameTab).not.toHaveBeenCalled();
});
