import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../src/components/App';
import { exampleThreads, type Thread } from '../../src/lib/models';
import type { Bootstrap, Projection } from '../../src/shared/runtime';
import { encodeFrame } from '../../src/shared/frame';
import { openThreadTerminal } from '../../src/client/thread-actions';

// Keep App, navigation, TerminalPane/Input, and BrowserTerminalManager real.
// Only the native renderer and remote socket boundary are simulated.
const native = vi.hoisted(() => ({ terminals: [] as { textarea: HTMLTextAreaElement; writes: (() => void)[] }[] }));
vi.mock('@xterm/xterm', () => ({ Terminal: class {
  options = {}; cols = 80; rows = 24; modes = { sendFocusMode: false };
  textarea = document.createElement('textarea'); element?: HTMLElement; writes: (() => void)[] = [];
  constructor() { native.terminals.push(this); }
  open(host: HTMLElement) { this.element = document.createElement('div'); this.element.className = 'xterm-screen'; this.element.append(this.textarea); host.append(this.element); this.textarea.addEventListener('keyup', () => this.focus()); }
  resize(cols: number, rows: number) { this.cols = cols; this.rows = rows; }
  write(bytes: Uint8Array, finish: () => void) { this.element!.append(document.createTextNode(new TextDecoder().decode(bytes))); this.writes.push(finish); }
  focus() { this.textarea.focus(); }
  attachCustomWheelEventHandler() {} loadAddon() {} dispose() {}
  hasSelection() { return false; } getSelection() { return ''; }
  onSelectionChange() { return { dispose() {} }; }
  parser = { registerOscHandler: () => ({ dispose() {} }) };
} }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { proposeDimensions() { return { cols: 90, rows: 31 }; } } }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: class { onContextLoss() {} dispose() {} } }));
vi.mock('../../src/client/thread-actions', async (importOriginal) => ({ ...await importOriginal<typeof import('../../src/client/thread-actions')>(), openThreadTerminal: vi.fn() }));
vi.mock('bot-avatars', async (importOriginal) => ({ ...await importOriginal<typeof import('bot-avatars')>(), BotAvatar: () => null }));
vi.mock('../../src/components/PairingPrompt', () => ({ PairingPrompt: () => null }));
vi.mock('../../src/components/UpdateButton', () => ({ UpdateButton: () => null }));
vi.mock('../../src/components/SidebarMetrics', () => ({ SidebarMetrics: () => null }));
vi.mock('../../src/client/perf', async (importOriginal) => ({ ...await importOriginal<typeof import('../../src/client/perf')>(), perfAvailable: false, startPerf: () => () => {} }));
vi.mock('../../src/components/shortcuts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/components/shortcuts')>();
  return { ...actual, loadShortcuts: () => Promise.resolve(actual.getShortcuts()) };
});

class Socket {
  static OPEN = 1; static instances: Socket[] = [];
  readyState = 0; bufferedAmount = 0; binaryType = ''; sent: string[] = [];
  onopen?: () => void; onclose?: () => void; onmessage?: (event: { data: string | ArrayBuffer }) => void;
  constructor(readonly url: string) { Socket.instances.push(this); }
  open() { this.readyState = 1; this.onopen?.(); }
  close() { this.readyState = 3; this.onclose?.(); }
  send(value: string) { this.sent.push(value); }
  receive(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
  actions() { return this.sent.map((packet) => JSON.parse(packet)); }
}
afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear();
  Socket.instances = []; native.terminals = []; window.history.replaceState(null, '', '/');
});
const agent = { id: 'agent', terminalId: 'native-agent', title: 'Agent', kind: 'agent' as const };
const shell = { id: 'shell', terminalId: 'native-shell', title: 'Shell', kind: 'shell' as const };
const thread: Thread = { ...exampleThreads()[0], id: 'focus-thread', machineId: 'local', session: 'default', tabId: 'w1:t1', bindingState: 'attached', status: 'running', panes: [agent] };
const machine = { id: 'local', name: 'Local', session: 'default', connected: true, writable: true, projectPaths: {}, harnesses: [] };
const projection = (panes = [agent] as Thread['panes'], revision = 1): Projection => ({ machineId: 'local', generation: 'focus', revision, connected: true, freshAt: 'fresh', machine, projects: [], layouts: [], threads: [{ ...thread, panes }] });
async function start(initial: Projection, path = '/threads/focus-thread', narrow = false) {
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: narrow && query.includes('max-width'), addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  localStorage.setItem('webr-shortcuts', JSON.stringify({ nextPane: 'ctrl+j', previousPane: 'ctrl+k', openTerminal: 'ctrl+o' }));
  window.history.replaceState(null, '', path);
  const bootstrap: Bootstrap = { projections: [{ ...initial, revision: 0 }], machines: [machine], projects: [], threads: [], recoveryScope: 'focus' };
  const view = render(<App initialUrl={window.location.href} bootstrap={bootstrap} />);
  const [metadata, binary] = Socket.instances;
  await act(async () => { metadata.open(); binary.open(); metadata.receive({ type: 'projection', projection: initial }); });
  await waitFor(() => expect(binary.actions().filter((action) => action.type === 'open')).toHaveLength(1));
  return { view, metadata, binary };
}
type Open = { streamId: number; generation: number; terminalId: string; cols: number; rows: number };
function baseline(binary: Socket, open: Open, seq = 1, width = open.cols) {
  binary.onmessage!({ data: encodeFrame({ streamId: open.streamId, generation: open.generation, seq, width, height: open.rows, full: true, bytes: new TextEncoder().encode('preserved output') }).buffer as ArrayBuffer });
}
function finishWrites() { for (const terminal of native.terminals) for (const finish of terminal.writes.splice(0)) finish(); }
async function ready(binary: Socket, open: Open) {
  await act(async () => { binary.receive({ type: 'stream.opened', streamId: open.streamId, generation: open.generation, writable: true }); baseline(binary, open); finishWrites(); });
}
const type = (text: string) => userEvent.keyboard(`${text}{Enter}`);
const expectedInput = (open: Open, text: string) => Array.from(`${text}\r`, (character) => ({ type: 'input', streamId: open.streamId, generation: open.generation, text: character, paste: false }));

it('opens a split, switches with real app shortcuts, and routes bytes only to the chosen native stream through delayed baselines and background projections', async () => {
  const { view, metadata, binary } = await start(projection());
  const firstOpen = binary.actions().find((action) => action.type === 'open') as Open;
  await ready(binary, firstOpen);
  const first = screen.getByLabelText('Terminal input'); const firstHost = view.container.querySelector('.terminal-host');
  expect(document.activeElement).toBe(first);
  let resolveSplit!: (value: { paneId: string }) => void;
  vi.mocked(openThreadTerminal).mockReturnValueOnce(new Promise((resolve) => { resolveSplit = resolve; }));
  fireEvent.keyDown(first, { key: 'o', ctrlKey: true });
  expect(openThreadTerminal).toHaveBeenCalledTimes(1);
  await act(async () => { resolveSplit({ paneId: shell.id }); });
  await act(async () => metadata.receive({ type: 'projection', projection: projection([agent, shell], 2) }));
  const second = screen.getAllByLabelText('Terminal input')[1] as HTMLTextAreaElement;
  expect(document.activeElement).toBe(second); expect(second.readOnly).toBe(true);
  await waitFor(() => expect(binary.actions().filter((action) => action.type === 'open')).toHaveLength(2));
  const secondOpen = binary.actions().find((action) => action.type === 'open' && action.terminalId === shell.terminalId) as Open;
  expect(binary.actions().filter((action) => action.type === 'open').every((action) => action.takeover === false)).toBe(true);
  // Control acceptance, wrong-sized baseline, and unfinished renderer writes
  // must not unlock input. Focus ownership is already correct throughout.
  await act(async () => { binary.receive({ type: 'stream.opened', streamId: secondOpen.streamId, generation: secondOpen.generation, writable: true }); baseline(binary, secondOpen, 1, 80); finishWrites(); });
  expect(second.readOnly).toBe(true); await type('blocked');
  expect(binary.actions().filter((action) => action.type === 'input')).toEqual([]);
  await act(async () => baseline(binary, secondOpen, 2));
  expect(second.readOnly).toBe(true);
  await act(async () => finishWrites()); expect(second.readOnly).toBe(false);
  binary.sent = []; await type('shell prompt');
  expect(binary.actions().filter((action) => action.type === 'input')).toEqual(expectedInput(secondOpen, 'shell prompt'));
  // Window activation reclaims terminal size and waits for new matching full
  // baselines. This is a real manager readiness transition, not an onState mock.
  await act(async () => fireEvent(window, new Event('focus')));
  expect(document.activeElement).toBe(second); expect(second.readOnly).toBe(true);
  binary.sent = []; await type('blocked during resize');
  expect(binary.actions().filter((action) => action.type === 'input')).toEqual([]);
  const editor = document.createElement('input'); view.container.append(editor); editor.focus();
  await act(async () => { baseline(binary, firstOpen, 2); baseline(binary, secondOpen, 3); finishWrites(); });
  expect(document.activeElement).toBe(editor);
  for (const terminal of native.terminals) terminal.textarea.focus();
  expect(document.activeElement).toBe(editor); editor.remove();
  let revision = 2;
  for (const [key, target, open] of [['k', first, firstOpen], ['j', second, secondOpen], ['k', first, firstOpen]] as const) {
    fireEvent.keyDown(document.activeElement!, { key, ctrlKey: true });
    expect(document.activeElement).toBe(target);
    // Inactive native helpers and fresh background-thread updates cannot
    // promote themselves into the navigation owner while a prompt is typed.
    await act(async () => {
      for (const terminal of native.terminals) terminal.textarea.focus();
      metadata.receive({ type: 'projection', projection: { ...projection([agent, shell], ++revision), threads: [{ ...thread, panes: [agent, shell] }, { ...thread, id: 'background', tabId: 'other', title: `Background ${revision}`, panes: [] }] } });
    });
    expect(document.activeElement).toBe(target);
    binary.sent = []; await type('continued prompt');
    expect(binary.actions().filter((action) => action.type === 'input')).toEqual(expectedInput(open, 'continued prompt'));
  }
  await act(async () => {
    fireEvent.keyDown(first, { key: 'j', ctrlKey: true });
    fireEvent.keyDown(first, { key: 'j', ctrlKey: true });
  });
  expect(document.activeElement).toBe(first);
  binary.sent = []; await type('rapid navigation');
  expect(binary.actions().filter((action) => action.type === 'input')).toEqual(expectedInput(firstOpen, 'rapid navigation'));
  expect(native.terminals).toHaveLength(2);
  expect(view.container.querySelector('.terminal-host')).toBe(firstHost);
  expect(firstHost!.textContent).toContain('preserved output');
  expect(binary.actions().some((action) => action.type === 'open' || action.takeover)).toBe(false);
});

it('switches panes in a standalone tab on narrow screens without a deferred old input', async () => {
  const standalone: Projection = { ...projection(), threads: [], availableTabs: [{ tabId: 'w1:t1', workspaceId: 'w1', label: 'Shell', bound: false, panes: [agent] }] };
  const { metadata, binary } = await start(standalone, '/sessions/default/tabs/w1%3At1?machine=local', true);
  await ready(binary, binary.actions().find((action) => action.type === 'open'));
  const first = screen.getByLabelText('Terminal input');
  await act(async () => metadata.receive({ type: 'projection', projection: { ...standalone, revision: 2, availableTabs: [{ ...standalone.availableTabs![0], panes: [agent, shell] }] } }));
  fireEvent.keyDown(first, { key: 'j', ctrlKey: true });
  const chosen = screen.getByLabelText('Terminal input') as HTMLTextAreaElement;
  expect(chosen).not.toBe(first); expect(document.activeElement).toBe(chosen); expect(chosen.readOnly).toBe(true);
  await waitFor(() => expect(binary.actions().some((action) => action.type === 'open' && action.terminalId === shell.terminalId)).toBe(true));
  const open = binary.actions().find((action) => action.type === 'open' && action.terminalId === shell.terminalId);
  await ready(binary, open); binary.sent = []; await type('standalone');
  expect(binary.actions().filter((action) => action.type === 'input')).toEqual(expectedInput(open, 'standalone'));
});
