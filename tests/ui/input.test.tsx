import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TerminalInput } from '../../src/components/TerminalInput';
import { appShortcutAction } from '../../src/client/keyboard';
import { defaultShortcuts } from '../../src/components/shortcuts';
import { bindTerminalGestures } from '../../src/client/terminal-gestures';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('routes application shortcuts once in terminal capture, but preserves editing keys in composer and search', async () => {
  const native = vi.fn(); const app = vi.fn();
  const capture = (event: KeyboardEvent) => { const action = appShortcutAction(event, defaultShortcuts); if (action) { event.preventDefault(); app(action); } };
  window.addEventListener('keydown', capture, true);
  try {
    render(<><TerminalInput onInput={native} /><textarea aria-label="Composer" /><input aria-label="Search" /></>);
    const user = userEvent.setup(); screen.getByLabelText('Terminal input').focus();
    await user.keyboard('{Control>}h{/Control}'); expect(app).toHaveBeenCalledExactlyOnceWith('previousPane'); expect(native).not.toHaveBeenCalled();
    await user.keyboard('{Control>}c{/Control}'); expect(native).toHaveBeenCalledExactlyOnceWith('\x03');
    screen.getByLabelText('Composer').focus(); await user.keyboard('{Control>}h{/Control}'); screen.getByLabelText('Search').focus(); await user.keyboard('{Control>}j{/Control}'); expect(app).toHaveBeenCalledTimes(1);
  } finally { window.removeEventListener('keydown', capture, true); }
});
it('captures text/plain paste, not HTML or device responses, as one explicit paste intent', () => {
  const native = vi.fn(); render(<TerminalInput onInput={native} />);
  fireEvent.paste(screen.getByLabelText('Terminal input'), { clipboardData: { getData: (type: string) => type === 'text/plain' ? 'é🙂\nsecond line' : '<script>untrusted</script>' } });
  expect(native).toHaveBeenCalledExactlyOnceWith('é🙂\nsecond line', true);
});
it('does not send incomplete IME input and sends a completed Unicode composition only once', () => {
  const native = vi.fn(); render(<TerminalInput onInput={native} />); const field = screen.getByLabelText('Terminal input');
  fireEvent.compositionStart(field); fireEvent.change(field, { target: { value: '漢' } }); fireEvent.keyDown(field, { key: 'Enter', isComposing: true }); expect(native).not.toHaveBeenCalled();
  fireEvent.compositionEnd(field, { data: '漢字🙂' }); fireEvent.change(field, { target: { value: '漢字🙂' } }); expect(native).toHaveBeenCalledExactlyOnceWith('漢字🙂');
  fireEvent.keyDown(field, { key: 'a' }); fireEvent.change(field, { target: { value: 'a' } }); expect(native.mock.calls.at(-1)).toEqual(['a']);
});
it('reserves plain or Shift pointer gestures for selection and only forwards deliberate Alt gestures while writable', () => {
  const host = document.createElement('div'); document.body.append(host); const mouse = vi.fn(); const scroll = vi.fn(); let writable = true;
  vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 800, height: 240 } as DOMRect);
  const dispose = bindTerminalGestures(host, () => ({ element: host, cols: 80, rows: 24 }), () => ({ mouse, scroll }), () => writable);
  const pointer = (altKey: boolean, shiftKey = false) => host.dispatchEvent(new MouseEvent('pointerdown', { clientX: 125, clientY: 55, buttons: 1, altKey, shiftKey, cancelable: true }));
  pointer(false); pointer(true, true); expect(mouse).not.toHaveBeenCalled();
  pointer(true); expect(mouse).toHaveBeenCalledExactlyOnceWith('down', 'left', 12, 5, 0);
  let tick = () => {}; vi.stubGlobal('requestAnimationFrame', (run: () => void) => { tick = run; return 1; }); vi.stubGlobal('cancelAnimationFrame', () => {});
  host.dispatchEvent(new WheelEvent('wheel', { deltaY: -25, cancelable: true })); host.dispatchEvent(new WheelEvent('wheel', { deltaY: -20, cancelable: true })); tick(); expect(scroll).toHaveBeenCalledExactlyOnceWith('up', 2);
  writable = false; pointer(true); host.dispatchEvent(new WheelEvent('wheel', { deltaY: 40 })); expect(mouse).toHaveBeenCalledTimes(1); expect(scroll).toHaveBeenCalledTimes(1);
  dispose(); host.remove();
});
