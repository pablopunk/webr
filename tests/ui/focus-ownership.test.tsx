import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from '../../src/components/App';
import type { createRuntimeStore } from '../../src/client/store';
import type { Bootstrap, Projection } from '../../src/shared/runtime';
import { exampleThreads, type Pane, type Thread } from '../../src/lib/models';

const probe = vi.hoisted(() => ({ runtime: undefined as ReturnType<typeof createRuntimeStore> | undefined }));
vi.mock('../../src/client/terminal-manager', () => ({ BrowserTerminalManager: class { start() {} stop() {} } }));
vi.mock('bot-avatars', async (importOriginal) => ({ ...await importOriginal<typeof import('bot-avatars')>(), BotAvatar: () => null }));
vi.mock('../../src/components/PairingPrompt', () => ({ PairingPrompt: () => null }));
vi.mock('../../src/components/UpdateButton', () => ({ UpdateButton: () => null }));
vi.mock('../../src/components/SidebarMetrics', () => ({ SidebarMetrics: () => null }));
vi.mock('../../src/components/PerfOverlay', () => ({ PerfOverlay: () => null }));
vi.mock('../../src/client/perf', async (importOriginal) => ({ ...await importOriginal<typeof import('../../src/client/perf')>(), perfAvailable: false, startPerf: () => () => {} }));
vi.mock('../../src/components/shortcuts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/components/shortcuts')>();
  return { ...actual, loadShortcuts: () => Promise.resolve(actual.getShortcuts()) };
});
vi.mock('../../src/components/TerminalPane', async () => {
  const { useRuntime } = await import('../../src/client/provider');
  return { TerminalPane: ({ pane, active }: { pane: Pane; active: boolean }) => { probe.runtime = useRuntime().runtime; return <textarea className="terminal-input-capture" aria-label={`${pane.title} input`} data-active={active} />; } };
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); window.history.replaceState(null, '', '/'); });

const machine = { id: 'local', name: 'Local', session: 'default', connected: true, projectPaths: {}, harnesses: [], writable: true };
const panes: Pane[] = [{ id: 'w1:p1', terminalId: 'term_agent', title: 'Agent', kind: 'agent' }, { id: 'w1:p2', terminalId: 'term_shell', title: 'Shell', kind: 'shell' }];
const threadWith = (panes: Pane[]): Thread => ({ ...exampleThreads()[0], id: 'thread-fixture', machineId: 'local', session: 'default', tabId: 'w1:t1', panes, bindingState: 'attached' });
const projectionWith = (thread: Thread, revision: number): Projection => ({ machineId: 'local', generation: 'g1', revision, freshAt: null, connected: true, threads: [thread], projects: [], layouts: [] });
const bootstrapWith = (thread: Thread): Bootstrap => ({ projections: [projectionWith(thread, 1)], machines: [machine], projects: [], threads: [thread], recoveryScope: 'local' });
const activePane = () => screen.getAllByRole('textbox').find((element) => element.dataset.active === 'true')?.getAttribute('aria-label');
const openThread = () => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  window.history.replaceState(null, '', '/threads/thread-fixture');
  render(<App initialUrl={window.location.href} bootstrap={bootstrapWith(threadWith(panes))} />);
};

it('keeps the pane the user had when a projection reorders the panes', () => {
  openThread();
  expect(activePane()).toBe('Agent input');
  act(() => { probe.runtime!.getState().install(projectionWith(threadWith([...panes].reverse()), 2)); });
  expect(activePane()).toBe('Agent input');
});

it('leaves keyboard focus in the terminal when a sidebar button is pressed', () => {
  openThread();
  const input = screen.getByLabelText('Agent input'); input.focus();
  expect(fireEvent.pointerDown(screen.getByLabelText('Group by project'))).toBe(false);
  input.blur();
  expect(fireEvent.pointerDown(screen.getByLabelText('Group by project'))).toBe(true);
});
