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
  const view = render(<TerminalPane pane={{ id: 'w1:p1', terminalId: 'term_fixture', title: 'Shell', kind: 'shell' }} machineId="fixture" threadId="fixture-thread" active onFocus={() => {}} />);
  await waitFor(() => expect(fixture.mount).toHaveBeenCalledTimes(1)); expect(screen.queryByText('Request control')).toBeNull(); expect(view.container.querySelector('.terminal-controls')).toBeNull(); expect(fixture.onData).not.toHaveBeenCalled();
  fireEvent.contextMenu(screen.getByLabelText('Shell terminal'), { clientX: 20, clientY: 20 }); fireEvent.click(screen.getByText('Request control')); expect(fixture.control).toHaveBeenCalledTimes(1);
  await act(async () => fixture.mount.mock.calls[0][0].onState('Input control is active.', true)); expect(screen.getByLabelText('Terminal input')).toBeDefined();
  view.unmount(); expect(fixture.close).toHaveBeenCalledTimes(1);
});
