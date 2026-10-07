import { count } from './perf';
type Actions = { mouse: (action: 'down' | 'up' | 'drag' | 'move', button: 'left' | 'right' | 'middle', column: number, row: number, modifiers: number) => void; scroll: (direction: 'up' | 'down', lines: number, column?: number, row?: number) => void };
const MAX_LINES_PER_MESSAGE = 100;
const FALLBACK_CELL_HEIGHT = 20;
const SCROLL_SPEED = 10;
const flickGain = (pixels: number) => SCROLL_SPEED * (1 + Math.min(2, Math.abs(pixels) / 60));
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
  type PendingClick = { pointerId: number; button: number; x: number; y: number; column: number; row: number };
  const CLICK_MOVEMENT_LIMIT = 4;
  const cellAt = (event: MouseEvent) => {
    const { element, cols, rows } = screen(); const rect = element?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return undefined;
    const column = Math.floor((event.clientX - rect.left) / rect.width * cols); const row = Math.floor((event.clientY - rect.top) / rect.height * rows);
    return column < 0 || row < 0 || column >= cols || row >= rows ? undefined : { column, row };
  };
  let pendingClick: PendingClick | undefined;
  const clickDown = (event: PointerEvent) => {
    pendingClick = undefined;
    if (!writable() || event.altKey || event.shiftKey || event.ctrlKey || event.metaKey || event.button > 2) return;
    const cell = cellAt(event); if (cell) pendingClick = { pointerId: event.pointerId, button: event.button, x: event.clientX, y: event.clientY, ...cell };
  };
  const clickMove = (event: PointerEvent) => {
    if (!pendingClick || pendingClick.pointerId !== event.pointerId || !event.buttons) return;
    if (Math.hypot(event.clientX - pendingClick.x, event.clientY - pendingClick.y) > CLICK_MOVEMENT_LIMIT) pendingClick = undefined;
  };
  const clickUp = (event: PointerEvent) => {
    const pending = pendingClick; pendingClick = undefined;
    if (!pending || pending.pointerId !== event.pointerId || !writable() || event.altKey || event.shiftKey || event.ctrlKey || event.metaKey || Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > CLICK_MOVEMENT_LIMIT) return;
    const actions = control(); if (!actions) return;
    const button = pending.button === 2 ? 'right' : pending.button === 1 ? 'middle' : 'left';
    actions.mouse('down', button, pending.column, pending.row, 0); actions.mouse('up', button, pending.column, pending.row, 0);
  };
  const cancelClick = () => { pendingClick = undefined; };
  let pendingPixels = 0; let frame = 0; let pointerCell: { column: number; row: number } | undefined;
  const cellUnderPointer = (event: MouseEvent) => {
    const { element, cols, rows } = screen(); const rect = element?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return undefined;
    return { column: Math.min(cols, Math.max(1, Math.floor((event.clientX - rect.left) / rect.width * cols) + 1)), row: Math.min(rows, Math.max(1, Math.floor((event.clientY - rect.top) / rect.height * rows) + 1)) };
  };
  const cellHeight = () => { const { element, rows } = screen(); const height = element?.getBoundingClientRect().height; return height && rows ? height / rows : FALLBACK_CELL_HEIGHT; };
  const flushScroll = () => {
    frame = 0;
    const cell = cellHeight(); const lines = Math.trunc(pendingPixels / cell);
    if (!lines) return;
    pendingPixels -= lines * cell;
    control()?.scroll(lines < 0 ? 'up' : 'down', Math.min(MAX_LINES_PER_MESSAGE, Math.abs(lines)), pointerCell?.column, pointerCell?.row);
  };
  const wheel = (event: WheelEvent) => {
    if (!writable() || !event.deltaY) return;
    count('wheelEvents'); pointerCell = cellUnderPointer(event);
    event.preventDefault();
    const pixels = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * cellHeight() : event.deltaY;
    if (pixels * pendingPixels < 0) pendingPixels = 0;
    pendingPixels += pixels * flickGain(pixels);
    frame ||= requestAnimationFrame(flushScroll);
  };
  for (const type of ['pointerdown', 'pointerup', 'pointermove']) host.addEventListener(type, pointer as EventListener);
  host.addEventListener('pointerdown', clickDown as EventListener); host.addEventListener('pointermove', clickMove as EventListener);
  host.addEventListener('pointerup', clickUp as EventListener); host.addEventListener('pointercancel', cancelClick);
  host.addEventListener('wheel', wheel, { passive: false });
  return () => { for (const type of ['pointerdown', 'pointerup', 'pointermove']) host.removeEventListener(type, pointer as EventListener); host.removeEventListener('pointerdown', clickDown as EventListener); host.removeEventListener('pointermove', clickMove as EventListener); host.removeEventListener('pointerup', clickUp as EventListener); host.removeEventListener('pointercancel', cancelClick); host.removeEventListener('wheel', wheel); cancelAnimationFrame(frame); };
}
