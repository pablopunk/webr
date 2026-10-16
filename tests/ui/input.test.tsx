import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TerminalInput } from '../../src/components/TerminalInput';
import { appShortcutAction, armLeaderPrefix, peekLeaderPrefix, sequenceAction, sequenceStarters, takeLeaderPrefix } from '../../src/client/keyboard';
import { defaultShortcuts, keyCombo } from '../../src/components/shortcuts';
import { bindTerminalGestures } from '../../src/client/terminal-gestures';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('routes application shortcuts once in terminal capture, but preserves editing keys in composer and search', async () => {
  const native = vi.fn(); const app = vi.fn();
  const capture = (event: KeyboardEvent) => {
    const combo = keyCombo(event);
    if (!combo) return;
    const first = takeLeaderPrefix();
    if (first) {
      if (combo === first) return;
      const sequenced = sequenceAction(first, combo, defaultShortcuts);
      if (sequenced) { event.preventDefault(); app(sequenced); return; }
    }
    if (sequenceStarters(defaultShortcuts).has(combo)) { event.preventDefault(); armLeaderPrefix(combo); return; }
    const action = appShortcutAction(event, defaultShortcuts); if (action) { event.preventDefault(); app(action); }
  };
  window.addEventListener('keydown', capture, true);
  try {
    render(<><TerminalInput onInput={native} /><textarea aria-label="Composer" /><input aria-label="Search" /></>);
    const user = userEvent.setup(); screen.getByLabelText('Terminal input').focus();
    await user.keyboard('{Control>}b{/Control}'); expect(peekLeaderPrefix()).toBe('ctrl+b'); expect(native).not.toHaveBeenCalled();
    await user.keyboard('h'); expect(app).toHaveBeenCalledExactlyOnceWith('previousPane'); expect(native).not.toHaveBeenCalled();
    await user.keyboard('{Control>}c{/Control}'); expect(native).toHaveBeenCalledExactlyOnceWith('\x03');
    await user.keyboard('{Control>}b{/Control}'); await user.keyboard('{Control>}b{/Control}');
    expect(native).toHaveBeenCalledTimes(2); expect(native).toHaveBeenLastCalledWith('\x02'); expect(app).toHaveBeenCalledTimes(1);
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
it('forwards plain clicks to mouse-aware apps while preserving drag selection and Alt gestures', () => {
  const host = document.createElement('div'); document.body.append(host); const mouse = vi.fn(); const scroll = vi.fn(); let writable = true;
  vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 800, height: 240 } as DOMRect);
  const dispose = bindTerminalGestures(host, () => ({ element: host, cols: 80, rows: 24 }), () => ({ mouse, scroll }), () => writable);
  const pointer = (type: string, options: { x?: number; y?: number; button?: number; buttons?: number; altKey?: boolean; shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {}) => host.dispatchEvent(new MouseEvent(type, {
    clientX: options.x ?? 125, clientY: options.y ?? 55, button: options.button ?? 0, buttons: options.buttons ?? 1,
    altKey: options.altKey, shiftKey: options.shiftKey, ctrlKey: options.ctrlKey, metaKey: options.metaKey, cancelable: true,
  }));
  pointer('pointerdown'); pointer('pointerup', { buttons: 0 });
  expect(mouse.mock.calls).toEqual([['down', 'left', 12, 5, 0], ['up', 'left', 12, 5, 0]]);
  mouse.mockClear();
  pointer('pointerdown'); pointer('pointermove', { x: 150, buttons: 1 }); pointer('pointerup', { x: 150, buttons: 0 });
  pointer('pointerdown', { shiftKey: true }); pointer('pointerup', { shiftKey: true, buttons: 0 });
  expect(mouse).not.toHaveBeenCalled();
  pointer('pointerdown', { altKey: true }); pointer('pointerup', { altKey: true, buttons: 0 });
  expect(mouse.mock.calls).toEqual([['down', 'left', 12, 5, 0], ['up', 'left', 12, 5, 0]]);
  let tick = () => {}; vi.stubGlobal('requestAnimationFrame', (run: () => void) => { tick = run; return 1; }); vi.stubGlobal('cancelAnimationFrame', () => {});
  host.dispatchEvent(new WheelEvent('wheel', { deltaY: -25, cancelable: true })); host.dispatchEvent(new WheelEvent('wheel', { deltaY: -20, cancelable: true })); tick(); expect(scroll).toHaveBeenCalledExactlyOnceWith('up', 4, 1, 1);
  scroll.mockClear();
  // A trackpad graze under one row scrolls nothing, and its remainder is forgotten after a pause.
  let clock = performance.now() + 1000; const now = vi.spyOn(performance, 'now').mockImplementation(() => clock);
  host.dispatchEvent(new WheelEvent('wheel', { deltaY: -6, cancelable: true })); tick(); expect(scroll).not.toHaveBeenCalled();
  clock += 1000; host.dispatchEvent(new WheelEvent('wheel', { deltaY: -45, cancelable: true })); tick(); expect(scroll).toHaveBeenCalledExactlyOnceWith('up', 4, 1, 1);
  now.mockRestore();
  writable = false; pointer('pointerdown'); pointer('pointerup', { buttons: 0 }); pointer('pointerdown', { altKey: true }); host.dispatchEvent(new WheelEvent('wheel', { deltaY: 40 })); expect(mouse).toHaveBeenCalledTimes(2); expect(scroll).toHaveBeenCalledTimes(1);
  dispose(); host.remove();
});
