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
  const thread = { id: 'thread-1', machineId: 'm', tabId: 't', bindingState: 'attached', panes: [{ id: 'p', title: 'Agent', kind: 'agent' as const }] } as unknown as import('../src/lib/models').Thread;
  expect(decideFlipNavigation({ page: 'terminal', viewedMachineId: 'm', viewedTabId: 't', threads: [thread], floating, launchingOrRestoring: false })).toEqual({ to: 'thread', threadId: 'thread-1' });
  const demoted: import('../src/lib/models').Thread = { ...thread, panes: [{ id: 'p', title: 'Shell', kind: 'shell' as const }] };
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

it('survives malformed tab entries without throwing', () => {
  const projection = {
    machineId: 'fixture', generation: 'a', revision: 1, freshAt: null, connected: true, threads: [], projects: [], layouts: [],
    availableTabs: [
      null,
      undefined,
      { tabId: 'w1:good', workspaceId: 'w1', label: 'Good', bound: false, panes: [{ id: 'w1:p1', terminalId: 'term_1', title: 'Shell' }] },
      { workspaceId: 'w1', label: 'NoId', bound: false, panes: [{ id: 'w1:p2', terminalId: 'term_2', title: 'Shell' }] },
      { tabId: 'w1:nopanes', workspaceId: 'w1', label: 'NoPanes', bound: false },
      { tabId: 'w1:nullpanes', workspaceId: 'w1', label: 'NullPanes', bound: false, panes: null },
      { tabId: 'w1:nolabel', workspaceId: 'w1', bound: false, panes: [{ id: 'w1:p3', terminalId: 'term_3', title: 'Shell' }] },
    ],
  } as unknown as Projection;
  const floating = floatingTabsFromProjections([projection]);
  expect(floating.map((tab) => tab.tabId)).toEqual(['w1:good', 'w1:nolabel']);
  expect(floating.find((tab) => tab.tabId === 'w1:nolabel')?.label).toBe('w1:nolabel');
});

it('survives null projections and sorts a dozen tabs', () => {
  const tabs = Array.from({ length: 10 }, (_, index) => ({
    tabId: `w1:shell${index}`, workspaceId: 'w1', label: `Terminal ${9 - index}`, bound: false,
    panes: [{ id: `w1:p${index}`, terminalId: `term_${index}`, title: 'Shell' }],
  }));
  const projection = {
    machineId: 'local', generation: 'a', revision: 1, freshAt: null, connected: true, threads: [], projects: [], layouts: [],
    machine: { id: 'local', name: 'Local', connected: true, session: 'default', projectPaths: {}, harnesses: [] },
    availableTabs: [...tabs,
      { tabId: 'w1:agent1', workspaceId: 'w1', label: 'nvm', bound: true, panes: [{ id: 'w1:pa', terminalId: 'term_a', title: 'Agent' }] },
      { tabId: 'w1:agent2', workspaceId: 'w1', label: 'webr', bound: true, panes: [{ id: 'w1:pb', terminalId: 'term_b', title: 'Agent' }] }],
  } as unknown as Projection;
  const floating = floatingTabsFromProjections([null, undefined, projection] as unknown as Projection[]);
  expect(floating).toHaveLength(10);
  expect(floating.map((tab) => tab.label)).toEqual([...floating.map((tab) => tab.label)].sort());
});

it('keeps publishing when a pending terminal entry loses its panes', async () => {
  const target = new FakeTarget();
  let calls = 0;
  target.createWorkspace = async () => {
    ++calls;
    return calls === 1
      ? { workspaceId: 'w9', tabId: 'w1:pending', paneId: 'w1:pp', terminalId: 'term_pending' }
      : { workspaceId: 'w9', tabId: 'w1:pending2', paneId: 'w1:pp2', terminalId: 'term_pending2' };
  };
  const manager = new RuntimeManager(database(), [target]); cleanups.push(() => manager.close()); manager.start();
  await expect.poll(() => manager.bootstrap().machines[0]?.connected).toBe(true);
  const created = await manager.createTerminal('fixture', '/fixture', 'key-1');
  const pending = (manager as unknown as { pendingTerminalTabs: Map<string, Map<string, { tab: { panes: unknown[] } }>> }).pendingTerminalTabs.get('fixture')?.get(created.tabId);
  expect(pending).toBeDefined();
  pending!.tab.panes = [];
  target.state.tabs.push({ tab_id: created.tabId, workspace_id: 'w9', label: 'Terminal' });
  target.state.panes.push({ ...target.state.panes[0], pane_id: 'w1:real', terminal_id: 'term_real', tab_id: created.tabId, agent: null, focused: false });
  await manager.createTerminal('fixture', '/fixture', 'key-2');
  const tabs = manager.bootstrap().projections.find((projection) => projection.machineId === 'fixture')?.availableTabs ?? [];
  expect(tabs.some((tab) => tab.tabId === created.tabId)).toBe(true);
});

it('returns a stable reference for unchanged inputs', () => {
  const projection = {
    machineId: 'fixture', generation: 'a', revision: 1, freshAt: null, connected: true, threads: [], projects: [], layouts: [],
    machine: { id: 'fixture', name: 'Fixture', connected: true, session: 'fixture', projectPaths: {}, harnesses: [] },
    availableTabs: [
      { tabId: 'w1:t1', workspaceId: 'w1', label: 'Shell', bound: false, panes: [{ id: 'w1:p1', terminalId: 'term_1', title: 'Shell' }] },
    ],
  } as unknown as Projection;
  const projections = [projection];
  expect(floatingTabsFromProjections(projections)).toBe(floatingTabsFromProjections(projections));
  expect(floatingTabsFromProjections(projections, { fixture: 'a' })).toBe(floatingTabsFromProjections(projections, { fixture: 'a' }));
  const record = { fixture: projection };
  expect(floatingTabsFromProjections(record)).toBe(floatingTabsFromProjections(record));
});
