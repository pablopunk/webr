type Actions = { mouse: (action: 'down' | 'up' | 'drag' | 'move', button: 'left' | 'right' | 'middle', column: number, row: number, modifiers: number) => void; scroll: (direction: 'up' | 'down', lines: number) => void };
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
  const wheel = (event: WheelEvent) => {
    if (!writable() || !event.altKey || event.shiftKey || !event.deltaY) return;
    event.preventDefault(); control()?.scroll(event.deltaY < 0 ? 'up' : 'down', Math.min(100, Math.max(1, Math.ceil(Math.abs(event.deltaY) / 20))));
  };
  for (const type of ['pointerdown', 'pointerup', 'pointermove']) host.addEventListener(type, pointer as EventListener);
  host.addEventListener('wheel', wheel, { passive: false });
  return () => { for (const type of ['pointerdown', 'pointerup', 'pointermove']) host.removeEventListener(type, pointer as EventListener); host.removeEventListener('wheel', wheel); };
}
