export type ShortcutAction = 'nextThread' | 'previousThread' | 'nextPane' | 'previousPane' | 'toggleSidebar' | 'newThread' | 'openTerminal' | 'closePane';

export const shortcutLabels: Record<ShortcutAction, string> = {
  nextThread: 'Next thread', previousThread: 'Previous thread',
  nextPane: 'Next pane', previousPane: 'Previous pane',
  toggleSidebar: 'Toggle sidebar', newThread: 'New thread', openTerminal: 'New terminal', closePane: 'Close pane',
};

export const defaultShortcuts: Record<ShortcutAction, string> = {
  nextThread: 'ctrl+j', previousThread: 'ctrl+k',
  nextPane: 'ctrl+l', previousPane: 'ctrl+h',
  toggleSidebar: 'meta+b', newThread: 'ctrl+x', openTerminal: 'ctrl+e', closePane: 'ctrl+q',
};

export function getShortcuts(): Record<ShortcutAction, string> {
  try {
    const saved = JSON.parse(localStorage.getItem('webr-shortcuts') ?? '{}') as Record<string, string>;
    return { ...defaultShortcuts, ...Object.fromEntries(Object.entries(saved).filter(([action]) => Object.hasOwn(defaultShortcuts, action))) };
  } catch {
    return defaultShortcuts;
  }
}

export function shortcutKeys(combo: string): string[] {
  const keys: Record<string, string> = {
    ctrl: '⌃', alt: '⌥', meta: '⌘', shift: '⇧', space: 'Space', escape: 'Esc',
  };
  return combo.split('+').map((key) => keys[key] ?? key.toUpperCase());
}

export function formatShortcut(combo: string): string {
  return shortcutKeys(combo).join('');
}

export function keyCombo(event: KeyboardEvent | React.KeyboardEvent): string {
  const modifiers = [event.ctrlKey && 'ctrl', event.altKey && 'alt', event.metaKey && 'meta', event.shiftKey && 'shift'].filter(Boolean);
  const key = event.key.toLowerCase() === ' ' ? 'space' : event.key.toLowerCase();
  if (['control', 'alt', 'meta', 'shift'].includes(key)) return '';
  return [...modifiers, key].join('+');
}

export function isReservedShortcut(combo: string): boolean {
  return /^(meta\+(w|t|r|l|n)|ctrl\+(w|t|r|n))$/.test(combo) || !/(ctrl|alt|meta)\+/.test(combo);
}
