import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TerminalPane } from '../../src/components/TerminalPane';

const fixture = vi.hoisted(() => ({ onData: vi.fn(), control: vi.fn(), observe: vi.fn(), input: vi.fn(), close: vi.fn(), mount: vi.fn() }));
vi.mock('../../src/client/provider', () => ({ useRuntime: () => ({ terminals: fixture }) }));
vi.mock('@xterm/xterm', () => ({ Terminal: class {
  options = {}; cols = 80; rows = 24; element?: HTMLElement; onData = fixture.onData;
  parser = { registerOscHandler: () => ({ dispose() {} }) };
  loadAddon() {}
  open(host: HTMLElement) { this.element = document.createElement('div'); this.element.className = 'xterm-screen'; host.append(this.element); }
  hasSelection() { return false; } getSelection() { return 'selected text'; } dispose() {}
} }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { proposeDimensions() { return { cols: 90, rows: 31 }; } } }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
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
  expect(fixture.observe).toHaveBeenCalledTimes(1);
  view.rerender(<TerminalPane {...props} active />);
  expect(fixture.control).toHaveBeenCalledTimes(1);
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
