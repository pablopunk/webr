import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TerminalPane } from '../../src/components/TerminalPane';
import { terminalStartupCommands } from '../../src/client/terminal-presets';

const fixture = vi.hoisted(() => ({ onData: vi.fn(), control: vi.fn(), observe: vi.fn(), input: vi.fn(), close: vi.fn(), mount: vi.fn(), selection: '', dimensions: { cols: 90, rows: 31 } as { cols: number; rows: number }, osc: new Map<number, (data: string) => boolean>() }));
vi.mock('../../src/client/provider', () => ({ useRuntime: () => ({ terminals: fixture }) }));
vi.mock('@xterm/xterm', () => ({ Terminal: class {
  options = {}; cols = 80; rows = 24; element?: HTMLElement; onData = fixture.onData; onSelectionChange = () => ({ dispose() {} }); buffer = { active: { getLine: (row: number) => ({ isWrapped: false, translateToString: () => fixture.selection.split('\n')[row] ?? '' }) } }; getSelectionPosition() { const rows = fixture.selection.split('\n'); return fixture.selection ? { start: { x: 0, y: 0 }, end: { x: rows.at(-1)!.length, y: rows.length - 1 } } : undefined; } clearSelection() { fixture.selection = ''; }
  attachCustomWheelEventHandler() {}
  parser = { registerOscHandler: (code: number, handler: (data: string) => boolean) => { fixture.osc.set(code, handler); return { dispose() { fixture.osc.delete(code); } }; } };
  loadAddon() {}
  textarea = document.createElement('textarea'); modes = { sendFocusMode: true };
  open(host: HTMLElement) { this.element = document.createElement('div'); this.element.className = 'xterm-screen'; this.element.append(this.textarea); host.append(this.element); }
  focus() { this.textarea.focus(); }
  hasSelection() { return !!fixture.selection; } getSelection() { return fixture.selection; } dispose() {}
} }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { proposeDimensions() { return fixture.dimensions; } } }));
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: class { onContextLoss() {} dispose() {} } }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); fixture.selection = ''; fixture.dimensions = { cols: 90, rows: 31 }; });
it('keeps terminals free of control bars and leaves right-click to the browser', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  fixture.mount.mockImplementation((options) => { options.onState('Read-only', false); return { control: fixture.control, observe: fixture.observe, input: fixture.input, close: fixture.close, resize() {}, mouse() {}, scroll() {} }; });
  const view = render(<TerminalPane pane={{ id: 'w1:p1', terminalId: 'term_fixture', title: 'Shell', kind: 'shell' }} machineId="fixture" threadId="fixture-thread" active canControl={false} onFocus={() => {}} />);
  await waitFor(() => expect(fixture.mount).toHaveBeenCalledTimes(1)); expect(screen.queryByText('Request control')).toBeNull(); expect(view.container.querySelector('.terminal-controls')).toBeNull(); expect(fixture.onData).not.toHaveBeenCalled();
  fireEvent.contextMenu(screen.getByLabelText('Shell terminal'), { clientX: 20, clientY: 20 }); expect(screen.queryByRole('menu')).toBeNull(); expect(fireEvent.contextMenu(screen.getByLabelText('Shell terminal'))).toBe(true);
  await act(async () => fixture.mount.mock.calls[0][0].onState('Input control is active.', true)); expect(screen.getByLabelText('Terminal input')).toBeDefined();
  view.unmount(); expect(fixture.close).toHaveBeenCalledTimes(1);
});
it('mounts a standalone terminal with its tab identity instead of a thread id', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  fixture.mount.mockImplementation(() => ({ control: fixture.control, observe: fixture.observe, input: fixture.input, close: fixture.close, resize() {}, mouse() {}, scroll() {} }));
  render(<TerminalPane pane={{ id: 'w2:p1', terminalId: 'term_shell', title: 'Shell', kind: 'shell' }} machineId="fixture" tabId="w2:t1" active canControl onFocus={() => {}} />);
  await waitFor(() => expect(fixture.mount).toHaveBeenCalledTimes(1));
  expect(fixture.mount.mock.calls[0][0]).toMatchObject({ machineId: 'fixture', tabId: 'w2:t1', terminalId: 'term_shell' });
  expect(fixture.mount.mock.calls[0][0]).not.toHaveProperty('threadId');
});
it('retains terminal DOM and its read-only input on disconnect while suppressing control', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  fixture.mount.mockImplementation(() => ({ control: fixture.control, observe: fixture.observe, input: fixture.input, close: fixture.close, resize() {}, mouse() {}, scroll() {} }));
  const pane = { id: 'w1:p1', terminalId: 'term_fixture', title: 'Agent', kind: 'agent' as const };
  const props = { pane, machineId: 'fixture', threadId: 'fixture-thread', active: true, canControl: true, onFocus: () => {} };
  const view = render(<TerminalPane {...props} connected />);
  await waitFor(() => expect(fixture.mount).toHaveBeenCalledTimes(1));
  const mounted = fixture.mount.mock.calls[0][0];
  await act(async () => mounted.onState('Input control is active.', true));
  expect(screen.getByLabelText('Terminal input')).toBeDefined();
  const host = view.container.querySelector('.terminal-host'); const cachedOutput = document.createElement('span'); cachedOutput.textContent = 'cached terminal output'; host!.append(cachedOutput);
  view.rerender(<TerminalPane {...props} connected={false} />);
  await act(async () => mounted.onState('Disconnected; input is disabled.', false));
  expect(view.container.querySelector('.terminal-host')).toBe(host); expect(host!.contains(cachedOutput)).toBe(true);
  expect((screen.getByLabelText('Terminal input') as HTMLTextAreaElement).readOnly).toBe(true);
  fixture.input.mockClear(); fireEvent.change(screen.getByLabelText('Terminal input'), { target: { value: 'offline' } }); expect(fixture.input).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText('Agent terminal')); expect(fixture.control).not.toHaveBeenCalled();
});

it('keeps the same focused input through resize readiness changes without losing typed input', async () => {
  await mountWritablePane();
  const input = screen.getByLabelText('Terminal input') as HTMLTextAreaElement;
  const { onState } = fixture.mount.mock.calls[0][0];
  expect(document.activeElement).toBe(input);
  await act(async () => onState('Waiting for the resized full baseline.', false));
  expect(screen.getByLabelText('Terminal input')).toBe(input);
  expect(document.activeElement).toBe(input); expect(input.readOnly).toBe(true);
  fixture.input.mockClear(); fireEvent.keyDown(input, { key: 'Enter' }); expect(fixture.input).not.toHaveBeenCalled();
  await act(async () => onState('Input control is active.', true));
  expect(document.activeElement).toBe(input); expect(input.readOnly).toBe(false);
  fireEvent.change(input, { target: { value: 'still typing' } });
  expect(fixture.input).toHaveBeenCalledWith('still typing', undefined);
});

it('autofocuses a newly writable terminal but does not steal focus back from an editor on resize', async () => {
  const launcher = document.createElement('button'); document.body.append(launcher); launcher.focus();
  const view = await mountWritablePane();
  expect(document.activeElement).toBe(screen.getByLabelText('Terminal input'));
  launcher.remove();
  const editor = document.createElement('input'); view.container.append(editor); editor.focus();
  const { onState } = fixture.mount.mock.calls[0][0];
  await act(async () => onState('Waiting for the resized full baseline.', false));
  await act(async () => onState('Input control is active.', true));
  expect(document.activeElement).toBe(editor);
  fireEvent(window, new Event('focus')); expect(document.activeElement).toBe(editor);
});

it('takes focus back when the browser drops it on the body, but never from another field', async () => {
  let tick = () => {}; vi.stubGlobal('requestAnimationFrame', (run: () => void) => { tick = run; return 1; }); vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  fixture.mount.mockImplementation(() => ({ control: fixture.control, observe: fixture.observe, input: fixture.input, close: fixture.close, resize() {}, mouse() {}, scroll() {} }));
  const props = { pane: { id: 'w1:p1', terminalId: 'term_fixture', title: 'Agent', kind: 'agent' as const }, machineId: 'fixture', threadId: 'fixture-thread', active: true, canControl: true, onFocus: () => {} };
  const view = render(<TerminalPane {...props} />);
  await waitFor(() => expect(fixture.mount).toHaveBeenCalledTimes(1));
  await act(async () => fixture.mount.mock.calls[0][0].onState('Input control is active.', true));
  const input = screen.getByLabelText('Terminal input');
  expect(document.activeElement).toBe(input);
  // A DOM move or a click on a dead area leaves focus on <body>: take it back next frame.
  input.blur(); expect(document.activeElement).toBe(document.body);
  tick(); expect(document.activeElement).toBe(input);
  // Any re-render of the active pane also notices focus resting nowhere.
  input.blur(); view.rerender(<TerminalPane {...props} />); expect(document.activeElement).toBe(input);
  // Typing with no focus anywhere reaches the terminal and reclaims focus, for control keys too.
  input.blur(); fixture.input.mockClear(); fireEvent.keyDown(document.body, { key: 'Enter' });
  expect(document.activeElement).toBe(input); expect(fixture.input).toHaveBeenLastCalledWith('\r');
  const editor = document.createElement('input'); view.container.append(editor); editor.focus();
  view.rerender(<TerminalPane {...props} />); expect(document.activeElement).toBe(editor);
  editor.remove(); input.focus();
  // While a pointer is down the user may be selecting text: wait for the release, then leave a selection alone.
  const note = document.createElement('p'); note.textContent = 'copy this path'; document.body.append(note);
  fireEvent.pointerDown(note); input.blur(); tick(); expect(document.activeElement).toBe(document.body);
  const range = document.createRange(); range.selectNodeContents(note); document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range);
  fireEvent.pointerUp(note); tick(); expect(document.activeElement).toBe(document.body);
  view.rerender(<TerminalPane {...props} />); expect(document.activeElement).toBe(document.body);
  document.getSelection()!.removeAllRanges(); view.rerender(<TerminalPane {...props} />); expect(document.activeElement).toBe(input);
  fireEvent.pointerDown(note); input.blur(); tick(); fireEvent.pointerUp(note); tick(); expect(document.activeElement).toBe(input);
  note.remove();
});

it('moves real keyboard focus between split panes even when the destination has a selection', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const inputs = new Map<string, ReturnType<typeof vi.fn>>();
  fixture.mount.mockImplementation((options) => {
    const input = vi.fn(); inputs.set(options.terminalId, input);
    return { control: fixture.control, observe: fixture.observe, input, close: fixture.close, resize() {}, mouse() {}, scroll() {} };
  });
  const onFocus = vi.fn();
  const panes = (active: string, ids = ['one', 'two']) => <>{ids.map((id) => <TerminalPane key={id} pane={{ id, terminalId: id, title: id, kind: 'shell' }} machineId="fixture" threadId="fixture-thread" active={active === id} canControl onFocus={onFocus} />)}</>;
  // Open a split after its first pane has loaded. Concurrent intercepted lazy
  // imports in Vitest can resolve the second xterm import to the real package.
  const view = render(panes('one', ['one']));
  await waitFor(() => expect(fixture.mount).toHaveBeenCalledTimes(1));
  view.rerender(panes('one'));
  await waitFor(() => expect(fixture.mount).toHaveBeenCalledTimes(2));
  await act(async () => { for (const [options] of fixture.mount.mock.calls) options.onState('Input control is active.', true); });
  const [first, second] = screen.getAllByLabelText('Terminal input');
  expect(document.activeElement).toBe(first);
  fixture.selection = 'selected output';
  for (const id of ['two', 'one', 'two']) {
    inputs.forEach((input) => input.mockClear()); onFocus.mockClear();
    view.rerender(panes(id));
    const target = id === 'one' ? first : second;
    expect(document.activeElement).toBe(target);
    expect(onFocus).not.toHaveBeenCalled();
    inputs.forEach((input) => input.mockClear());
    fireEvent.change(target, { target: { value: id } });
    expect(inputs.get(id)).toHaveBeenCalledWith(id, undefined);
    expect(inputs.get(id === 'one' ? 'two' : 'one')).not.toHaveBeenCalled();
  }
  inputs.forEach((input) => input.mockClear());
  // A stale browser event must never type into an inactive pane.
  fireEvent.change(first, { target: { value: 'stale' } });
  expect(inputs.get('one')).not.toHaveBeenCalled();
  fireEvent.keyDown(first, { key: 'z' });
  expect(inputs.get('two')).toHaveBeenCalledWith('z');
});

it('does not queue a startup command while disconnected or replay it after reconnection', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  fixture.mount.mockImplementation(() => ({ control: fixture.control, observe: fixture.observe, input: fixture.input, close: fixture.close, resize() {}, mouse() {}, scroll() {} }));
  const onStartupComplete = vi.fn();
  const props = { pane: { id: 'w2:p1', terminalId: 'term_shell', title: 'Shell', kind: 'shell' as const }, machineId: 'fixture', tabId: 'w2:t1', active: false, canControl: true, onFocus: () => {}, startupPreset: 'resource-monitor' as const, onStartupComplete };
  const view = render(<TerminalPane {...props} connected={false} />);
  await waitFor(() => expect(fixture.mount).toHaveBeenCalledTimes(1));
  expect(onStartupComplete).toHaveBeenCalledOnce(); expect(fixture.input).not.toHaveBeenCalled();
  view.rerender(<TerminalPane {...props} connected />);
  await act(async () => fixture.mount.mock.calls[0][0].onState('Input control is active.', true));
  expect(fixture.input).not.toHaveBeenCalled();
});

it('starts a resource monitor once the terminal is writable', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  fixture.mount.mockImplementation(() => ({ control: fixture.control, observe: fixture.observe, input: fixture.input, close: fixture.close, resize() {}, mouse() {}, scroll() {} }));
  const onStartupComplete = vi.fn();
  render(<TerminalPane pane={{ id: 'w2:p1', terminalId: 'term_shell', title: 'Shell', kind: 'shell' }} machineId="fixture" tabId="w2:t1" active canControl onFocus={() => {}} startupPreset="resource-monitor" onStartupComplete={onStartupComplete} />);
  await waitFor(() => expect(fixture.mount).toHaveBeenCalledTimes(1));
  const { onState } = fixture.mount.mock.calls[0][0];
  expect(fixture.input).not.toHaveBeenCalled();
  await act(async () => onState('Input control is active.', true));
  const command = `${terminalStartupCommands['resource-monitor']}\r`;
  expect(command).toBe("sh -c 'if command -v btop >/dev/null 2>&1; then exec btop; elif command -v htop >/dev/null 2>&1; then exec htop; else exec top; fi'\r");
  expect(fixture.input).toHaveBeenCalledWith(command);
  expect(fixture.input.mock.calls.filter(([text]) => text === command)).toHaveLength(1);
  expect(onStartupComplete).toHaveBeenCalledOnce();
  await act(async () => onState('Disconnected', false));
  await act(async () => onState('Input control is active.', true));
  expect(fixture.input.mock.calls.filter(([text]) => text === command)).toHaveLength(1);
  expect(onStartupComplete).toHaveBeenCalledOnce();
});
it('requests control only for an approved active pane and passes typed keys to the terminal', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  fixture.mount.mockImplementation(() => ({ control: fixture.control, observe: fixture.observe, input: fixture.input, close: fixture.close, resize() {}, mouse() {}, scroll() {} }));
  const pane = { id: 'w1:p1', terminalId: 'term_fixture', title: 'Agent', kind: 'agent' as const };
  const props = { pane, machineId: 'fixture', threadId: 'fixture-thread', canControl: true, onFocus: () => {} };
  const view = render(<TerminalPane {...props} active />);
  await waitFor(() => expect(fixture.mount).toHaveBeenCalledTimes(1));
  expect(fixture.mount.mock.calls[0][0].mode).toBe('control'); expect(fixture.mount.mock.calls[0][0]).toMatchObject({ cols: 90, rows: 31 });
  await act(async () => fixture.mount.mock.calls[0][0].onState('Input control is active.', true));
  fireEvent.change(screen.getByLabelText('Terminal input'), { target: { value: 'x' } });
  expect(fixture.input).toHaveBeenCalledWith('x', undefined);
  view.rerender(<TerminalPane {...props} active={false} />);
  view.rerender(<TerminalPane {...props} active />);
  expect(fixture.observe).not.toHaveBeenCalled(); expect(fixture.control).not.toHaveBeenCalled();
});
it('requests control by itself when a read-only pane is clicked, with no menu', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  fixture.mount.mockImplementation((options) => { options.onState('Read-only', false); return { control: fixture.control, observe: fixture.observe, input: fixture.input, close: fixture.close, resize() {}, mouse() {}, scroll() {} }; });
  render(<TerminalPane pane={{ id: 'w1:p1', terminalId: 'term_fixture', title: 'Agent', kind: 'agent' }} machineId="fixture" threadId="fixture-thread" active canControl onFocus={() => {}} />);
  await waitFor(() => expect(fixture.mount).toHaveBeenCalledTimes(1)); fixture.control.mockClear();
  fireEvent.click(screen.getByLabelText('Agent terminal')); expect(fixture.control).toHaveBeenCalledTimes(1);
});
it('sends keys and pastes with no focus anywhere, and leaves other inputs alone', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  fixture.mount.mockImplementation(() => ({ control: fixture.control, observe: fixture.observe, input: fixture.input, close: fixture.close, resize() {}, mouse() {}, scroll() {} }));
  render(<><input aria-label="Search" /><TerminalPane pane={{ id: 'w1:p1', terminalId: 'term_fixture', title: 'Agent', kind: 'agent' }} machineId="fixture" threadId="fixture-thread" active canControl onFocus={() => {}} /></>);
  await waitFor(() => expect(fixture.mount).toHaveBeenCalledTimes(1));
  await act(async () => fixture.mount.mock.calls[0][0].onState('Input control is active.', true));
  (document.activeElement as HTMLElement | null)?.blur();
  fireEvent.keyDown(document.body, { key: 'Enter' }); expect(fixture.input).toHaveBeenLastCalledWith('\r');
  fireEvent.keyDown(document.body, { key: 'c', ctrlKey: true }); expect(fixture.input).toHaveBeenLastCalledWith('\x03');
  const paste = new Event('paste', { bubbles: true, cancelable: true }); Object.assign(paste, { clipboardData: { getData: () => 'pasted text' } }); document.body.dispatchEvent(paste); expect(fixture.input).toHaveBeenLastCalledWith('pasted text', true);
  fixture.input.mockClear(); fireEvent.keyDown(screen.getByLabelText('Search'), { key: 'Enter' }); expect(fixture.input).not.toHaveBeenCalled();
});
it('moves focus from the terminal emulator to the input', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  let helper: HTMLTextAreaElement | undefined;
  fixture.mount.mockImplementation((options) => { helper = options.terminal.textarea; return { control: fixture.control, observe: fixture.observe, input: fixture.input, close: fixture.close, resize() {}, mouse() {}, scroll() {} }; });
  render(<TerminalPane pane={{ id: 'w1:p1', terminalId: 'term_fixture', title: 'Agent', kind: 'agent' }} machineId="fixture" threadId="fixture-thread" active canControl onFocus={() => {}} />);
  await waitFor(() => expect(fixture.mount).toHaveBeenCalledTimes(1));
  await act(async () => fixture.mount.mock.calls[0][0].onState('Input control is active.', true));
  document.body.append(helper!); helper!.focus();
  expect(document.activeElement).toBe(screen.getByLabelText('Terminal input'));
});
it('reports focus to applications that ask for it, so they draw a solid cursor while typing works', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  fixture.mount.mockImplementation(() => ({ control: fixture.control, observe: fixture.observe, input: fixture.input, close: fixture.close, resize() {}, mouse() {}, scroll() {} }));
  render(<TerminalPane pane={{ id: 'w1:p1', terminalId: 'term_fixture', title: 'Agent', kind: 'agent' }} machineId="fixture" threadId="fixture-thread" active canControl onFocus={() => {}} />);
  await waitFor(() => expect(fixture.mount).toHaveBeenCalledTimes(1));
  await act(async () => fixture.mount.mock.calls[0][0].onState('Input control is active.', true));
  const input = screen.getByLabelText('Terminal input'); fixture.input.mockClear();
  input.blur(); expect(fixture.input).toHaveBeenLastCalledWith('\x1b[O'); input.focus(); expect(fixture.input).toHaveBeenLastCalledWith('\x1b[I');
});
const mountWritablePane = async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  fixture.mount.mockImplementation(() => ({ control: fixture.control, observe: fixture.observe, input: fixture.input, close: fixture.close, resize() {}, mouse() {}, scroll() {} }));
  const view = render(<TerminalPane pane={{ id: 'w1:p1', terminalId: 'term_fixture', title: 'Agent', kind: 'agent' }} machineId="local" threadId="fixture-thread" active canControl onFocus={() => {}} />);
  await waitFor(() => expect(fixture.mount).toHaveBeenCalledTimes(1));
  await act(async () => fixture.mount.mock.calls[0][0].onState('Input control is active.', true));
  fixture.input.mockClear(); return view;
};
const image = (name = 'shot.png', type = 'image/png') => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type });
const filesTransfer = (files: File[]) => ({ files, types: ['Files'], dropEffect: 'none' });
it('uploads a dropped image and pastes its path into the terminal, with an overlay while dragging', async () => {
  const upload = vi.fn(async () => ({ ok: true, json: async () => ({ path: '/data/uploads/image-1.png' }) })); vi.stubGlobal('fetch', upload);
  const view = await mountWritablePane();
  fireEvent.dragEnter(window, { dataTransfer: filesTransfer([image()]) }); expect(view.container.querySelector('.terminal-drop-overlay')).not.toBeNull();
  fireEvent.drop(window, { dataTransfer: filesTransfer([image()]) }); expect(view.container.querySelector('.terminal-drop-overlay')).toBeNull();
  await waitFor(() => expect(fixture.input).toHaveBeenCalledWith('/data/uploads/image-1.png ', true));
  expect(upload).toHaveBeenCalledWith('/api/uploads?machineId=local', expect.objectContaining({ method: 'POST', headers: { 'Content-Type': 'image/png' } }));
  expect(view.container.textContent).toContain('File attached');
});
it('attaches a pasted screenshot and several images in one paste', async () => {
  let count = 0; vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ path: `/u/image ${++count}.png` }) })));
  await mountWritablePane();
  const paste = new Event('paste', { bubbles: true, cancelable: true }); Object.assign(paste, { clipboardData: { files: [image('a.png'), image('b.jpg', 'image/jpeg')], getData: () => '' } });
  document.body.dispatchEvent(paste);
  await waitFor(() => expect(fixture.input).toHaveBeenCalledWith('/u/image\\ 1.png /u/image\\ 2.png ', true));
});
it('explains what went wrong instead of silently ignoring a drop', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: 'uploads_unsupported_target' }) })));
  const view = await mountWritablePane();
  fireEvent.drop(window, { dataTransfer: filesTransfer([new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.zip')]) });
  await waitFor(() => expect(view.container.textContent).toContain('This file is larger than 5 MB.'));
  fireEvent.drop(window, { dataTransfer: filesTransfer([image()]) });
  await waitFor(() => expect(view.container.textContent).toContain('Files cannot be attached on this machine yet.')); expect(fixture.input).not.toHaveBeenCalled();
});
const stubClipboard = () => { const writeText = vi.fn(async () => {}); vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } }); return writeText; };
it('copies the selection when the mouse is released, like Herdr copy on select', async () => {
  const writeText = stubClipboard(); const view = await mountWritablePane();
  fixture.selection = 'npm run dev'; fireEvent.mouseUp(view.container.querySelector('.terminal-host')!);
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('npm run dev')); await waitFor(() => expect(view.container.textContent).toContain('Copied to clipboard'));
  writeText.mockClear(); fixture.selection = ''; fireEvent.mouseUp(view.container.querySelector('.terminal-host')!); expect(writeText).not.toHaveBeenCalled();
});
it('offers to open or copy a selected link that was broken over several lines', async () => {
  stubClipboard(); const open = vi.spyOn(window, 'open').mockReturnValue(null); const view = await mountWritablePane();
  fixture.selection = 'https://example.com/auth?\n  code=1&state=2  '; fireEvent.mouseUp(view.container.querySelector('.terminal-host')!);
  fireEvent.click(await screen.findByText('Open link'));
  expect(open).toHaveBeenCalledWith('https://example.com/auth?code=1&state=2', '_blank', 'noopener,noreferrer'); expect(screen.queryByText('Open link')).toBeNull();
  fixture.selection = 'npm run dev'; fireEvent.mouseUp(view.container.querySelector('.terminal-host')!); expect(screen.queryByText('Open link')).toBeNull();
});
it('puts the selection on the clipboard for the copy shortcut', async () => {
  await mountWritablePane(); fixture.selection = 'selected text';
  const setData = vi.fn(); const copy = new Event('copy', { bubbles: true, cancelable: true }); Object.assign(copy, { clipboardData: { setData } });
  window.dispatchEvent(copy); expect(setData).toHaveBeenCalledWith('text/plain', 'selected text'); expect(copy.defaultPrevented).toBe(true);
});
it('copies text that the controlled terminal application sends with OSC 52', async () => {
  const writeText = stubClipboard(); await mountWritablePane();
  expect(fixture.osc.get(52)!('c;' + btoa('copied by agent'))).toBe(true);
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('copied by agent'));
});
it('ignores OSC 52 clipboard writes on a read-only pane', async () => {
  const writeText = stubClipboard(); vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  fixture.mount.mockImplementation((options) => { options.onState('Read-only', false); return { control: fixture.control, observe: fixture.observe, input: fixture.input, close: fixture.close, resize() {}, mouse() {}, scroll() {} }; });
  render(<TerminalPane pane={{ id: 'w1:p1', terminalId: 'term_fixture', title: 'Agent', kind: 'agent' }} machineId="fixture" threadId="fixture-thread" active canControl={false} onFocus={() => {}} />);
  await waitFor(() => expect(fixture.mount).toHaveBeenCalledTimes(1));
  fixture.osc.get(52)!('c;' + btoa('secret')); await Promise.resolve(); expect(writeText).not.toHaveBeenCalled();
});
it('keeps an unfocused split pane in control so it keeps its own size', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  fixture.mount.mockImplementation(() => ({ control: fixture.control, observe: fixture.observe, input: fixture.input, close: fixture.close, resize() {}, mouse() {}, scroll() {} }));
  const props = { pane: { id: 'w1:p2', terminalId: 'term_shell', title: 'Shell', kind: 'shell' as const }, machineId: 'fixture', threadId: 'fixture-thread', canControl: true, onFocus: () => {} };
  render(<TerminalPane {...props} active={false} />);
  await waitFor(() => expect(fixture.mount).toHaveBeenCalledTimes(1));
  expect(fixture.mount.mock.calls[0][0]).toMatchObject({ mode: 'control', cols: 90, rows: 31 });
});
it('takes focus on pointer down even when the terminal swallows the click', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  fixture.mount.mockImplementation(() => ({ control: fixture.control, observe: fixture.observe, input: fixture.input, close: fixture.close, resize() {}, mouse() {}, scroll() {} }));
  const onFocus = vi.fn();
  render(<TerminalPane pane={{ id: 'w1:p2', terminalId: 'term_shell', title: 'Shell', kind: 'shell' }} machineId="fixture" threadId="fixture-thread" active={false} canControl onFocus={onFocus} />);
  fireEvent.pointerDown(screen.getByLabelText('Shell terminal')); expect(onFocus).toHaveBeenCalledOnce();
});
it('draws a solid cursor in the focused pane and an outline in the other one', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  fixture.mount.mockImplementation(() => ({ control: fixture.control, observe: fixture.observe, input: fixture.input, close: fixture.close, resize() {}, mouse() {}, scroll() {} }));
  const props = { pane: { id: 'w1:p2', terminalId: 'term_shell', title: 'Shell', kind: 'shell' as const }, machineId: 'fixture', threadId: 'fixture-thread', canControl: true, onFocus: () => {} };
  const view = render(<TerminalPane {...props} active={false} />);
  await waitFor(() => expect(fixture.mount).toHaveBeenCalledTimes(1));
  const { terminal, onState } = fixture.mount.mock.calls[0][0];
  await act(async () => onState('Input control is active.', true)); expect(terminal.options.cursorInactiveStyle).toBe('outline');
  view.rerender(<TerminalPane {...props} active />); expect(terminal.options.cursorInactiveStyle).toBe('block');
  expect(document.activeElement).toBe(screen.getByLabelText('Terminal input'));
});
it('never sends an unmeasurable size while a pane leaves the layout', async () => {
  let observed!: () => void; vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { observed = callback; } observe() {} disconnect() {} });
  const resize = vi.fn(); fixture.dimensions = { cols: NaN, rows: NaN };
  fixture.mount.mockImplementation(() => ({ control: fixture.control, observe: fixture.observe, input: fixture.input, close: fixture.close, resize, mouse() {}, scroll() {} }));
  render(<TerminalPane pane={{ id: 'w1:p1', terminalId: 'term_fixture', title: 'Shell', kind: 'shell' }} machineId="fixture" threadId="fixture-thread" active canControl onFocus={() => {}} />);
  await waitFor(() => expect(fixture.mount).toHaveBeenCalledTimes(1));
  const { cols, rows } = fixture.mount.mock.calls[0][0]; expect(Number.isFinite(cols) && Number.isFinite(rows)).toBe(true);
  observed(); await new Promise((resolve) => setTimeout(resolve, 200)); expect(resize).not.toHaveBeenCalled();
});
