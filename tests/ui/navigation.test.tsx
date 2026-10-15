import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import App from '../../src/components/App';
import { handleRouteClick, RouteNavigationProvider, useRouteNavigation } from '../../src/client/app-navigation';
import { RuntimeProvider, useRuntime } from '../../src/client/provider';
import { readLaunchDraft, readNewThreadDraft, writeLaunchDraft } from '../../src/client/new-thread-draft';
import type { Bootstrap } from '../../src/shared/runtime';
import { ThreadView } from '../../src/components/ThreadView';
import { TerminalTabView } from '../../src/components/TerminalTabView';
import { exampleThreads, type Pane, type Thread } from '../../src/lib/models';

vi.mock('../../src/client/terminal-manager', () => ({
  BrowserTerminalManager: class {
    start() {}
    stop() {}
  },
}));
vi.mock('../../src/components/PairingPrompt', () => ({ PairingPrompt: () => null }));
vi.mock('../../src/components/UpdateButton', () => ({ UpdateButton: () => null }));
vi.mock('../../src/components/SidebarMetrics', () => ({ SidebarMetrics: () => null }));
vi.mock('../../src/components/TerminalPane', async () => {
  const { createElement } = await import('react');
  return { TerminalPane: ({ pane }: { pane: { terminalId?: string; title: string } }) => createElement('div', { 'data-testid': 'retained-terminal', 'data-terminal-id': pane.terminalId }, pane.title) };
});
vi.mock('../../src/components/PerfOverlay', () => ({ PerfOverlay: () => null }));
vi.mock('../../src/client/perf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/perf')>();
  return { ...actual, perfAvailable: false, startPerf: () => () => {} };
});
vi.mock('../../src/components/shortcuts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/components/shortcuts')>();
  return { ...actual, loadShortcuts: () => Promise.resolve(actual.getShortcuts()) };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

const bootstrap: Bootstrap = { projections: [], machines: [], projects: [], threads: [], recoveryScope: 'local' };
const deferredFetch = () => vi.fn(() => new Promise<Response>(() => {}));

function NavigationProbe() {
  const { route, navigate } = useRouteNavigation();
  const runtime = useRuntime();
  const queryClient = useQueryClient();
  const [modifiedClickPrevented, setModifiedClickPrevented] = useState<boolean | null>(null);
  const identities = useRef({ runtime: runtime.runtime, ui: runtime.ui, terminals: runtime.terminals, queryClient });
  const routeLabel = route.type === 'composer' ? `composer:${route.projectId ?? ''}`
    : route.type === 'thread' ? `thread:${route.threadId}`
      : route.type === 'terminal' ? `terminal:${route.session}|${route.tabId}|${route.machineId}`
        : route.type;
  const onRouteClick = (event: React.MouseEvent<HTMLDivElement>) => handleRouteClick(event, navigate);
  return <div onClickCapture={onRouteClick}>
    <output aria-label="Selected route">{routeLabel}</output>
    <output aria-label="Provider identity">{identities.current.runtime === runtime.runtime && identities.current.ui === runtime.ui && identities.current.terminals === runtime.terminals && identities.current.queryClient === queryClient ? 'stable' : 'changed'}</output>
    <output aria-label="Modified click default">{modifiedClickPrevented === null ? 'unset' : String(modifiedClickPrevented)}</output>
    <a href="/threads/known">Known thread</a>
    <a href="/sessions/session%252Fone/tabs/tab%2Fone?machine=machine%252Fone">Encoded terminal</a>
    <a href="/settings" onClick={(event) => { setModifiedClickPrevented(event.defaultPrevented); event.preventDefault(); }}>Modified settings</a>
    <button type="button" onClick={() => navigate('/settings')}>Open settings</button>
  </div>;
}

it('keeps the attached thread layout and terminal DOM mounted while disconnected', () => {
  const pane = { id: 'w1:p1', terminalId: 'term_fixture', title: 'Agent', kind: 'agent' } as Pane;
  const thread = { id: 'thread-fixture', machineId: 'machine-fixture', title: 'Retained thread', bindingState: 'attached', panes: [pane] } as Thread;
  const props = { thread, canControl: true, onFocusPane: vi.fn(), focusedPane: pane.id, windowStart: 0, narrow: true };
  const view = render(<ThreadView {...props} connected />);
  const terminal = screen.getByTestId('retained-terminal'); const layout = view.container.querySelector('.pane-tabbed');
  view.rerender(<ThreadView {...props} connected={false} />);
  expect(screen.getByTestId('retained-terminal')).toBe(terminal);
  expect(view.container.querySelector('.pane-tabbed')).toBe(layout);
  expect(screen.getByRole('status').textContent).toContain('input is disabled');
});

it('keeps a standalone terminal tab mounted through connectivity loss', () => {
  const pane: Pane = { id: 'w1:p1', terminalId: 'term_fixture', title: 'Shell', kind: 'shell' };
  const props = { machineId: 'local', tabId: 'w1:t1', panes: [pane], canControl: true, focusedPane: pane.id, onFocusPane: vi.fn(), windowStart: 0, narrow: true, pending: false, onStartupComplete: vi.fn() };
  const view = render(<TerminalTabView {...props} connected />);
  const terminal = screen.getByTestId('retained-terminal'); const layout = view.container.querySelector('.pane-tabbed');
  view.rerender(<TerminalTabView {...props} connected={false} />);
  expect(screen.getByTestId('retained-terminal')).toBe(terminal);
  expect(view.container.querySelector('.pane-tabbed')).toBe(layout);
  expect(screen.getByRole('status').textContent).toContain('input is disabled');
});

it('does not flip a terminal route from stale retained binding data', () => {
  vi.stubGlobal('fetch', deferredFetch());
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const pane: Pane = { id: 'w1:p1', terminalId: 'term_fixture', title: 'Agent', kind: 'agent' };
  const thread: Thread = { ...exampleThreads()[0], id: 'thread-fixture', machineId: 'local', session: 'default', tabId: 'w1:t1', panes: [pane], bindingState: 'attached' };
  const staleBootstrap: Bootstrap = {
    projections: [{ machineId: 'local', generation: 'g1', revision: 4, freshAt: null, connected: false, threads: [thread], projects: [], layouts: [{ workspaceId: 'w1', tabId: 'w1:t1', area: { x: 0, y: 0, width: 80, height: 24 }, panes: [{ paneId: pane.id, rect: { x: 0, y: 0, width: 80, height: 24 } }] }], machine: { id: 'local', name: 'Local', session: 'default', connected: false, projectPaths: {}, harnesses: [], writable: true }, availableTabs: [{ tabId: 'w1:t1', workspaceId: 'w1', label: 'Agent', bound: true, panes: [{ id: pane.id, terminalId: pane.terminalId!, title: pane.title }] }] }],
    machines: [{ id: 'local', name: 'Local', session: 'default', connected: false, projectPaths: {}, harnesses: [], writable: true }], projects: [], threads: [thread], recoveryScope: 'local',
  };
  window.history.replaceState(null, '', '/sessions/default/tabs/w1%3At1?machine=local');
  const view = render(<App initialUrl={window.location.href} bootstrap={staleBootstrap} />);
  expect(window.location.pathname).toBe('/sessions/default/tabs/w1%3At1');
  expect(screen.getByTestId('retained-terminal')).toBeDefined();
  expect(screen.getByRole('status').textContent).toContain('input is disabled');
  expect(view.container.querySelector('.pane-tabbed, .pane-strip')).toBeTruthy();
});

it('changes supported links locally, preserves route state and provider identities, and handles popstate', () => {
  const fetchMock = deferredFetch();
  vi.stubGlobal('fetch', fetchMock);
  const previousState = { keep: 'history state' };
  window.history.replaceState(previousState, '', '/new?project=first&sidebar=collapsed');
  const initialUrl = window.location.href;

  render(<RuntimeProvider bootstrap={bootstrap}>
    <RouteNavigationProvider initialUrl={initialUrl}><NavigationProbe /></RouteNavigationProvider>
  </RuntimeProvider>);
  expect(screen.getByLabelText('Selected route').textContent).toBe('composer:first');
  expect(screen.getByLabelText('Provider identity').textContent).toBe('stable');

  fireEvent.click(screen.getByRole('link', { name: 'Known thread' }));
  expect(screen.getByLabelText('Selected route').textContent).toBe('thread:known');
  expect(window.location.pathname).toBe('/threads/known');
  expect(new URLSearchParams(window.location.search).get('sidebar')).toBe('collapsed');
  expect(window.history.state).toEqual(previousState);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Provider identity').textContent).toBe('stable');

  fireEvent.click(screen.getByRole('link', { name: 'Encoded terminal' }));
  expect(screen.getByLabelText('Selected route').textContent).toBe('terminal:session%2Fone|tab/one|machine%2Fone');
  expect(window.location.pathname).toBe('/sessions/session%252Fone/tabs/tab%2Fone');

  fireEvent.click(screen.getByRole('link', { name: 'Modified settings' }), { ctrlKey: true });
  expect(screen.getByLabelText('Selected route').textContent).toContain('terminal:');
  expect(screen.getByLabelText('Modified click default').textContent).toBe('false');

  act(() => {
    window.history.pushState(window.history.state, '', '/settings');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  expect(screen.getByLabelText('Selected route').textContent).toBe('settings');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('removes the recovery query during the initial composer mount', () => {
  vi.stubGlobal('fetch', deferredFetch());
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  window.history.replaceState(null, '', '/new?recover=initial-recovery');
  writeLaunchDraft('local', 'initial-recovery', { prompt: 'Restored prompt', images: [], projectId: 'p', machineId: 'local', harness: 'claude', worktree: true });
  localStorage.setItem('webr-launch-draft:initial-recovery', JSON.stringify({ prompt: 'Legacy secret', images: [] }));

  render(<App initialUrl={window.location.href} bootstrap={bootstrap} />);

  expect(window.location.pathname).toBe('/new');
  expect(new URLSearchParams(window.location.search).has('recover')).toBe(false);
  expect(readLaunchDraft('local', 'initial-recovery')).toBeUndefined();
  expect(localStorage.getItem('webr-launch-draft:initial-recovery')).toBeNull();
  expect(readNewThreadDraft('local').prompt).toBe('Restored prompt');
});

it('keeps a thread with stale missing data pending instead of redirecting or waiting on a document fetch', () => {
  const fetchMock = deferredFetch();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  window.history.replaceState(null, '', '/threads/not-yet-observed');
  const staleBootstrap: Bootstrap = {
    projections: [{ machineId: 'local', generation: 'generation-1', revision: 1, freshAt: null, connected: false, threads: [], projects: [], layouts: [], availableTabs: [] }],
    machines: [{ id: 'local', name: 'Local', session: 'default', connected: false, projectPaths: {}, harnesses: [], writable: true }],
    projects: [],
    threads: [],
    recoveryScope: 'local',
  };

  render(<App initialUrl={window.location.href} bootstrap={staleBootstrap} />);
  expect(screen.getByRole('status').textContent).toContain('Waiting for this thread to appear');
  expect(window.location.pathname).toBe('/threads/not-yet-observed');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('keeps an unknown terminal tab pending while its projection is stale', () => {
  const fetchMock = deferredFetch();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  window.history.replaceState(null, '', '/sessions/default/tabs/not-yet-observed?machine=local');
  const staleBootstrap: Bootstrap = {
    projections: [{ machineId: 'local', generation: 'generation-1', revision: 1, freshAt: null, connected: false, threads: [], projects: [], layouts: [], availableTabs: [] }],
    machines: [{ id: 'local', name: 'Local', session: 'default', connected: false, projectPaths: {}, harnesses: [], writable: true }],
    projects: [],
    threads: [],
    recoveryScope: 'local',
  };

  render(<App initialUrl={window.location.href} bootstrap={staleBootstrap} />);
  expect(screen.getByRole('status').textContent).toContain('Waiting for this terminal tab to appear');
  expect(window.location.pathname).toBe('/sessions/default/tabs/not-yet-observed');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('declares a missing thread only after every scoped machine has a fresh observation', () => {
  vi.stubGlobal('fetch', deferredFetch());
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  window.history.replaceState(null, '', '/threads/confirmed-missing');
  const freshBootstrap: Bootstrap = {
    projections: [{ machineId: 'local', generation: 'generation-1', revision: 2, freshAt: new Date().toISOString(), connected: true, threads: [], projects: [], layouts: [], availableTabs: [] }],
    machines: [{ id: 'local', name: 'Local', session: 'default', connected: true, projectPaths: {}, harnesses: [], writable: true }],
    projects: [],
    threads: [],
    recoveryScope: 'local',
  };

  render(<App initialUrl={window.location.href} bootstrap={freshBootstrap} />);
  expect(screen.getByRole('heading', { name: 'Thread not found' })).toBeDefined();
  expect(window.location.pathname).toBe('/threads/confirmed-missing');
});
