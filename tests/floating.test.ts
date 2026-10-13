import { afterEach, expect, it } from 'vitest';
import { MetadataDatabase } from '../src/server/storage/database';
import { RuntimeManager } from '../src/server/runtime/manager';
import { decideFlipNavigation, floatingTabsFromProjections, sidebarTabKey } from '../src/lib/floating';
import { FakeTarget } from './fixtures/target';
import type { Projection } from '../src/shared/runtime';

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });

const database = () => { const db = new MetadataDatabase(':memory:'); cleanups.push(() => db.close()); return db; };

it('keys sidebar items by machine and tab', () => {
  expect(sidebarTabKey('local', 'w1:t1')).toBe('local:w1:t1');
});

it('derives floating tabs from unbound projections with panes', () => {
  const projection = {
    machineId: 'fixture', generation: 'a', revision: 1, freshAt: null, connected: true, threads: [], projects: [], layouts: [],
    machine: { id: 'fixture', name: 'Fixture', connected: true, session: 'fixture', projectPaths: {}, harnesses: [] },
    availableTabs: [
      { tabId: 'w1:t1', workspaceId: 'w1', label: 'Shell', bound: false, panes: [{ id: 'w1:p1', terminalId: 'term_1', title: 'Shell' }] },
      { tabId: 'w1:t2', workspaceId: 'w1', label: 'Bound', bound: true, panes: [{ id: 'w1:p2', terminalId: 'term_2', title: 'Shell' }] },
      { tabId: 'w1:t3', workspaceId: 'w1', label: 'Empty', bound: false, panes: [] },
    ],
  } as unknown as Projection;
  const floating = floatingTabsFromProjections([projection]);
  expect(floating.map((tab) => tab.tabId)).toEqual(['w1:t1']);
  expect(floating[0]).toMatchObject({ machineId: 'fixture', session: 'fixture', paneCount: 1 });
});

it('navigates from terminal to thread on promotion and back on demotion', () => {
  const floating = [{ machineId: 'm', session: 's', tabId: 't', workspaceId: 'w', label: 'Shell', paneCount: 1, panes: [] }];
  const thread = { id: 'thread-1', machineId: 'm', tabId: 't', bindingState: 'attached', panes: [{ id: 'p', title: 'Agent', kind: 'agent' }] } as never;
  expect(decideFlipNavigation({ page: 'terminal', viewedMachineId: 'm', viewedTabId: 't', threads: [thread], floating, launchingOrRestoring: false })).toEqual({ to: 'thread', threadId: 'thread-1' });
  const demoted = { ...thread, panes: [{ id: 'p', title: 'Shell', kind: 'shell' }] } as never;
  expect(decideFlipNavigation({ page: 'thread', viewedThreadId: 'thread-1', threads: [demoted], floating, launchingOrRestoring: false })).toEqual({ to: 'terminal', session: 's', machineId: 'm', tabId: 't' });
  expect(decideFlipNavigation({ page: 'terminal', viewedMachineId: 'm', viewedTabId: 't', threads: [thread], floating, launchingOrRestoring: true })).toEqual({ to: null });
});

it('closes an unbound tab and asks for confirmation when a pane is busy', async () => {
  const target = new FakeTarget();
  const pane = target.state.panes[0];
  target.state.tabs.push({ tab_id: 'w1:t9', workspace_id: 'w1', label: 'Floating' });
  target.state.panes.push({ ...pane, pane_id: 'w1:p9', terminal_id: 'term_floating', tab_id: 'w1:t9', agent: null, focused: false });
  target.state.layouts.push({ workspace_id: 'w1', tab_id: 'w1:t9', area: { x: 0, y: 0, width: 80, height: 24 }, panes: [{ pane_id: 'w1:p9', rect: { x: 0, y: 0, width: 80, height: 24 } }] });
  const manager = new RuntimeManager(database(), [target]); cleanups.push(() => manager.close()); manager.start();
  await expect.poll(() => manager.bootstrap().projections.find((projection) => projection.machineId === target.id)?.availableTabs?.some((tab) => tab.tabId === 'w1:t9')).toBe(true);
  target.busyPanes.add('w1:p9');
  expect(await manager.closeTab('fixture', 'w1:t9', false)).toEqual({ closed: false, busy: true });
  expect(target.state.tabs.map((tab) => tab.tab_id)).toContain('w1:t9');
  expect(await manager.closeTab('fixture', 'w1:t9', true)).toEqual({ closed: true, busy: false });
  expect(target.state.tabs.map((tab) => tab.tab_id)).not.toContain('w1:t9');
});

it('refuses to close a thread-owned tab', async () => {
  const target = new FakeTarget();
  const manager = new RuntimeManager(database(), [target]); cleanups.push(() => manager.close()); manager.start();
  await expect.poll(() => manager.bootstrap().threads.length).toBe(1);
  const thread = manager.bootstrap().threads[0];
  await expect(manager.closeTab('fixture', thread.tabId, true)).rejects.toThrow('binding_conflict');
});

it('reports a missing tab', async () => {
  const target = new FakeTarget();
  const manager = new RuntimeManager(database(), [target]); cleanups.push(() => manager.close()); manager.start();
  await expect.poll(() => manager.bootstrap().machines[0].connected).toBe(true);
  await expect(manager.closeTab('fixture', 'w1:missing', true)).rejects.toThrow('tab_not_found');
});
