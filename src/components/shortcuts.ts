export type ShortcutAction = 'nextThread' | 'previousThread' | 'nextPane' | 'previousPane' | 'toggleSidebar' | 'newThread' | 'openTerminal' | 'closePane';

export const shortcutLabels: Record<ShortcutAction, string> = {
  nextThread: 'Next thread', previousThread: 'Previous thread',
  nextPane: 'Next pane', previousPane: 'Previous pane',
  toggleSidebar: 'Toggle sidebar', newThread: 'New thread', openTerminal: 'New terminal', closePane: 'Close pane',
};

// Which Herdr action each Webr action mirrors. Webr threads are Herdr tabs,
// so thread navigation follows next_tab/previous_tab and pane actions follow
// the Herdr pane bindings.
export const WEBR_TO_HERDR: Record<ShortcutAction, string> = {
  nextThread: 'next_tab', previousThread: 'previous_tab',
  nextPane: 'focus_pane_right', previousPane: 'focus_pane_left',
  toggleSidebar: 'toggle_sidebar', newThread: 'new_tab', openTerminal: 'split_vertical', closePane: 'close_pane',
};

export type HerdrKeymap = {
  prefix: string;
  prefixes: string[];
  bindings: Record<string, string[]>;
  stock: Record<string, string[]>;
};

// Stock Herdr defaults (prefix ctrl+b). Used before /api/herdr-keys loads or
// when the server is unreachable; the live keymap overrides these at runtime.
export const defaultShortcuts: Record<ShortcutAction, string> = {
  nextThread: 'ctrl+b n', previousThread: 'ctrl+b p',
  nextPane: 'ctrl+b l', previousPane: 'ctrl+b h',
  toggleSidebar: 'ctrl+b b', newThread: 'ctrl+b c', openTerminal: 'ctrl+b v', closePane: 'ctrl+b x',
};

const OVERRIDE_KEY = 'webr-shortcuts';
const HERDR_CACHE_KEY = 'webr-herdr-shortcuts';

export function herdrDefaultsForWebr(keymap: HerdrKeymap): Record<ShortcutAction, string> {
  const next = { ...defaultShortcuts };
  for (const [action, herdr] of Object.entries(WEBR_TO_HERDR) as [ShortcutAction, string][]) {
    const combo = keymap.bindings[herdr]?.[0] ?? keymap.stock[herdr]?.[0];
    if (combo) next[action] = combo;
  }
  return next;
}

const readStored = (key: string): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
};

const validOverrides = (entries: Record<string, string>) =>
  Object.fromEntries(Object.entries(entries).filter(([action]) => Object.hasOwn(defaultShortcuts, action)));

export function getShortcuts(): Record<ShortcutAction, string> {
  return { ...defaultShortcuts, ...validOverrides(readStored(HERDR_CACHE_KEY)), ...validOverrides(readStored(OVERRIDE_KEY)) };
}

let keymapPromise: Promise<HerdrKeymap | undefined> | undefined;
export function loadHerdrKeymap(): Promise<HerdrKeymap | undefined> {
  if (typeof fetch === 'undefined') return Promise.resolve(undefined);
  keymapPromise ??= fetch('/api/herdr-keys')
    .then((response) => (response.ok ? response.json() as Promise<HerdrKeymap> : undefined))
    .catch(() => undefined);
  return keymapPromise;
}

// Fetch the live Herdr keymap, adopt its bindings as the new defaults, and
// return the effective shortcuts (Herdr defaults + custom overrides).
export function loadShortcuts(): Promise<Record<ShortcutAction, string>> {
  return loadHerdrKeymap().then((keymap) => {
    if (keymap) {
      try {
        localStorage.setItem(HERDR_CACHE_KEY, JSON.stringify(herdrDefaultsForWebr(keymap)));
      } catch { /* Storage unavailable; stock defaults still apply. */ }
    }
    return getShortcuts();
  });
}

export function saveShortcut(action: ShortcutAction, combo: string): void {
  try {
    localStorage.setItem(OVERRIDE_KEY, JSON.stringify({ ...validOverrides(readStored(OVERRIDE_KEY)), [action]: combo }));
  } catch { /* Storage unavailable; the change lasts for this page load. */ }
}

export function resetShortcuts(): Record<ShortcutAction, string> {
  try {
    localStorage.removeItem(OVERRIDE_KEY);
  } catch { /* Storage unavailable. */ }
  return getShortcuts();
}

const keySymbols: Record<string, string> = {
  ctrl: '⌃', alt: '⌥', meta: '⌘', shift: '⇧', space: 'Space', escape: 'Esc', tab: 'Tab',
  minus: '-', plus: '+', comma: ',', left: '←', right: '→', up: '↑', down: '↓',
};

// Combos are single chords ("ctrl+h") or prefix sequences ("ctrl+a x").
export const isSequence = (combo: string): boolean => combo.includes(' ');
export const sequenceParts = (combo: string): string[] => combo.split(' ').filter(Boolean);

export function shortcutSequence(combo: string): string[][] {
  return sequenceParts(combo).map((chord) => chord.split('+').filter(Boolean).map((key) => keySymbols[key] ?? key.toUpperCase()));
}

export function shortcutKeys(combo: string): string[] {
  return shortcutSequence(combo).flatMap((chord, index) => (index ? ['›', ...chord] : chord));
}

export function formatShortcut(combo: string): string {
  return shortcutSequence(combo).map((chord) => chord.join('')).join(' ');
}

export function keyCombo(event: KeyboardEvent | React.KeyboardEvent): string {
  const modifiers = [event.ctrlKey && 'ctrl', event.altKey && 'alt', event.metaKey && 'meta', event.shiftKey && 'shift'].filter(Boolean);
  const key = event.key.toLowerCase() === ' ' ? 'space' : event.key.toLowerCase();
  if (['control', 'alt', 'meta', 'shift'].includes(key)) return '';
  return [...modifiers, key].join('+');
}

export function isReservedShortcut(combo: string): boolean {
  if (isSequence(combo)) return isReservedShortcut(sequenceParts(combo)[0]);
  if (/^(meta\+(w|t|r|l|n)|ctrl\+(w|t|r|n))$/.test(combo)) return true;
  return !/(ctrl|alt|meta|shift)\+/.test(combo);
}
