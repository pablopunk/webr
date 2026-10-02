type Actions = { mouse: (action: 'down' | 'up' | 'drag' | 'move', button: 'left' | 'right' | 'middle', column: number, row: number, modifiers: number) => void; scroll: (direction: 'up' | 'down', lines: number) => void };
const PIXELS_PER_LINE = 20;
export function bindTerminalGestures(host: HTMLElement, screen: () => { element?: HTMLElement; cols: number; rows: number }, control: () => Actions | null, writable: () => boolean) {
  const pointer = (event: PointerEvent) => {
    if (!writable() || !event.altKey || event.shiftKey) return;
    const { element, cols, rows } = screen(); const rect = element?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return;
    const column = Math.floor((event.clientX - rect.left) / rect.width * cols); const row = Math.floor((event.clientY - rect.top) / rect.height * rows);
    if (column < 0 || row < 0 || column >= cols || row >= rows) return;
    event.preventDefault();
    const button = event.button === 2 || event.buttons & 2 ? 'right' : event.button === 1 || event.buttons & 4 ? 'middle' : 'left';
    control()?.mouse(event.type === 'pointerdown' ? 'down' : event.type === 'pointerup' ? 'up' : event.buttons ? 'drag' : 'move', button, column, row, event.ctrlKey ? 2 : 0);
  };
  let pendingPixels = 0; let frame = 0;
  const flushScroll = () => {
    frame = 0;
    const lines = Math.trunc(pendingPixels / PIXELS_PER_LINE);
    if (!lines) return;
    pendingPixels -= lines * PIXELS_PER_LINE;
    control()?.scroll(lines < 0 ? 'up' : 'down', Math.min(100, Math.abs(lines)));
  };
  const wheel = (event: WheelEvent) => {
    if (!writable() || !event.deltaY) return;
    event.preventDefault();
    pendingPixels += event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * PIXELS_PER_LINE : event.deltaY;
    frame ||= requestAnimationFrame(flushScroll);
  };
  for (const type of ['pointerdown', 'pointerup', 'pointermove']) host.addEventListener(type, pointer as EventListener);
  host.addEventListener('wheel', wheel, { passive: false });
  return () => { for (const type of ['pointerdown', 'pointerup', 'pointermove']) host.removeEventListener(type, pointer as EventListener); host.removeEventListener('wheel', wheel); cancelAnimationFrame(frame); };
}
