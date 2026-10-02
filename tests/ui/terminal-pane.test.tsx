import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TerminalPane } from '../../src/components/TerminalPane';

const fixture = vi.hoisted(() => ({ onData: vi.fn(), control: vi.fn(), observe: vi.fn(), input: vi.fn(), close: vi.fn(), mount: vi.fn(), selection: '', osc: new Map<number, (data: string) => boolean>() }));
vi.mock('../../src/client/provider', () => ({ useRuntime: () => ({ terminals: fixture }) }));
vi.mock('@xterm/xterm', () => ({ Terminal: class {
  options = {}; cols = 80; rows = 24; element?: HTMLElement; onData = fixture.onData;
  attachCustomWheelEventHandler() {}
  parser = { registerOscHandler: (code: number, handler: (data: string) => boolean) => { fixture.osc.set(code, handler); return { dispose() { fixture.osc.delete(code); } }; } };
  loadAddon() {}
  textarea = document.createElement('textarea'); modes = { sendFocusMode: true };
  open(host: HTMLElement) { this.element = document.createElement('div'); this.element.className = 'xterm-screen'; host.append(this.element); }
  focus() { this.textarea.focus(); }
  hasSelection() { return !!fixture.selection; } getSelection() { return fixture.selection; } dispose() {}
} }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { proposeDimensions() { return { cols: 90, rows: 31 }; } } }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); fixture.selection = ''; });
it('keeps terminals free of control bars and leaves right-click to the browser', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  fixture.mount.mockImplementation((options) => { options.onState('Read-only', false); return { control: fixture.control, observe: fixture.observe, input: fixture.input, close: fixture.close, resize() {}, mouse() {}, scroll() {} }; });
  const view = render(<TerminalPane pane={{ id: 'w1:p1', terminalId: 'term_fixture', title: 'Shell', kind: 'shell' }} machineId="fixture" threadId="fixture-thread" active canControl={false} onFocus={() => {}} />);
  await waitFor(() => expect(fixture.mount).toHaveBeenCalledTimes(1)); expect(screen.queryByText('Request control')).toBeNull(); expect(view.container.querySelector('.terminal-controls')).toBeNull(); expect(fixture.onData).not.toHaveBeenCalled();
  fireEvent.contextMenu(screen.getByLabelText('Shell terminal'), { clientX: 20, clientY: 20 }); expect(screen.queryByRole('menu')).toBeNull(); expect(fireEvent.contextMenu(screen.getByLabelText('Shell terminal'))).toBe(true);
  await act(async () => fixture.mount.mock.calls[0][0].onState('Input control is active.', true)); expect(screen.getByLabelText('Terminal input')).toBeDefined();
  view.unmount(); expect(fixture.close).toHaveBeenCalledTimes(1);
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
  expect(view.container.textContent).toContain('Image attached');
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
  fireEvent.drop(window, { dataTransfer: filesTransfer([new File(['x'], 'notes.txt', { type: 'text/plain' })]) });
  await waitFor(() => expect(view.container.textContent).toContain('Only PNG, JPEG, GIF and WebP images can be attached.'));
  fireEvent.drop(window, { dataTransfer: filesTransfer([image()]) });
  await waitFor(() => expect(view.container.textContent).toContain('Images can be attached only on the Local machine for now.')); expect(fixture.input).not.toHaveBeenCalled();
});
const stubClipboard = () => { const writeText = vi.fn(async () => {}); vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } }); return writeText; };
it('copies the selection when the mouse is released, like Herdr copy on select', async () => {
  const writeText = stubClipboard(); const view = await mountWritablePane();
  fixture.selection = 'npm run dev'; fireEvent.mouseUp(view.container.querySelector('.terminal-host')!);
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('npm run dev')); expect(view.container.textContent).toContain('Copied to clipboard');
  writeText.mockClear(); fixture.selection = ''; fireEvent.mouseUp(view.container.querySelector('.terminal-host')!); expect(writeText).not.toHaveBeenCalled();
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
