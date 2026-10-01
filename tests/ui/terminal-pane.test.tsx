import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TerminalPane } from '../../src/components/TerminalPane';

const fixture = vi.hoisted(() => ({ onData: vi.fn(), control: vi.fn(), observe: vi.fn(), input: vi.fn(), close: vi.fn(), mount: vi.fn() }));
vi.mock('../../src/client/provider', () => ({ useRuntime: () => ({ terminals: fixture }) }));
vi.mock('@xterm/xterm', () => ({ Terminal: class {
  options = {}; cols = 80; rows = 24; element?: HTMLElement; onData = fixture.onData;
  parser = { registerOscHandler: () => ({ dispose() {} }) };
  open(host: HTMLElement) { this.element = document.createElement('div'); this.element.className = 'xterm-screen'; host.append(this.element); }
  hasSelection() { return false; } getSelection() { return 'selected text'; } dispose() {}
} }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
it('keeps terminals free of permanent control bars and exposes explicit controls only in the context menu', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  fixture.mount.mockImplementation((options) => { options.onState('Read-only', false); return { control: fixture.control, observe: fixture.observe, input: fixture.input, close: fixture.close, resize() {}, mouse() {}, scroll() {} }; });
  const view = render(<TerminalPane pane={{ id: 'w1:p1', terminalId: 'term_fixture', title: 'Shell', kind: 'shell' }} machineId="fixture" threadId="fixture-thread" active canControl={false} onFocus={() => {}} />);
  await waitFor(() => expect(fixture.mount).toHaveBeenCalledTimes(1)); expect(screen.queryByText('Request control')).toBeNull(); expect(view.container.querySelector('.terminal-controls')).toBeNull(); expect(fixture.onData).not.toHaveBeenCalled();
  fireEvent.contextMenu(screen.getByLabelText('Shell terminal'), { clientX: 20, clientY: 20 }); fireEvent.click(screen.getByText('Request control')); expect(fixture.control).toHaveBeenCalledTimes(1);
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
  expect(fixture.mount.mock.calls[0][0].mode).toBe('control');
  await act(async () => fixture.mount.mock.calls[0][0].onState('Input control is active.', true));
  fireEvent.change(screen.getByLabelText('Terminal input'), { target: { value: 'x' } });
  expect(fixture.input).toHaveBeenCalledWith('x', undefined);
  view.rerender(<TerminalPane {...props} active={false} />);
  expect(fixture.observe).toHaveBeenCalledTimes(1);
  view.rerender(<TerminalPane {...props} active />);
  expect(fixture.control).toHaveBeenCalledTimes(1);
});
