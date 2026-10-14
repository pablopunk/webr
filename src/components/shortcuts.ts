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
const PREFIX_KEY = 'webr-shortcut-prefix';
export const FALLBACK_PREFIX = 'ctrl+b';

type HerdrCache = { prefix: string; prefixes: string[]; defaults: Record<string, string> };

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

function readCache(): HerdrCache | undefined {
  try {
    const raw = JSON.parse(localStorage.getItem(HERDR_CACHE_KEY) ?? 'null') as HerdrCache | null;
    if (!raw || typeof raw !== 'object' || typeof raw.prefix !== 'string' || typeof raw.defaults !== 'object') return undefined;
    return raw;
  } catch {
    return undefined;
  }
}

export function getPrefixOverride(): string | undefined {
  try {
    const value = localStorage.getItem(PREFIX_KEY);
    return value || undefined;
  } catch {
    return undefined;
  }
}

export function getEffectivePrefix(): string {
  return getPrefixOverride() ?? readCache()?.prefix ?? FALLBACK_PREFIX;
}

// Rebase a combo from one prefix to another ("ctrl+a x" -> "ctrl+space x").
// Direct chords without a prefix pass through untouched.
export function rebaseCombo(combo: string, from: string, to: string): string {
  if (!from || from === to || !isSequence(combo)) return combo;
  const parts = sequenceParts(combo);
  return parts[0] === from ? [to, ...parts.slice(1)].join(' ') : combo;
}

// Same keymap, but every binding re-expressed under another prefix.
export function keymapWithPrefix(keymap: HerdrKeymap, prefix: string): HerdrKeymap {
  if (prefix === keymap.prefix) return keymap;
  const rebaseAll = (bindings: Record<string, string[]>) =>
    Object.fromEntries(Object.entries(bindings).map(([action, combos]) => [action, combos.map((combo) => rebaseCombo(combo, keymap.prefix, prefix))]));
  return { prefix, prefixes: keymap.prefixes, bindings: rebaseAll(keymap.bindings), stock: rebaseAll(keymap.stock) };
}

export function getShortcuts(): Record<ShortcutAction, string> {
  const effective = getEffectivePrefix();
  const stock = Object.fromEntries(
    Object.entries(defaultShortcuts).map(([action, combo]) => [action, rebaseCombo(combo, FALLBACK_PREFIX, effective)]));
  const cache = readCache();
  const herdr = cache
    ? validOverrides(Object.fromEntries(
      Object.entries(cache.defaults).map(([action, combo]) => [action, rebaseCombo(combo, cache.prefix, effective)])))
    : {};
  return { ...stock, ...herdr, ...validOverrides(readStored(OVERRIDE_KEY)) } as Record<ShortcutAction, string>;
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
        const effective = getPrefixOverride() ?? keymap.prefix;
        const defaults = herdrDefaultsForWebr(keymap);
        const rebased = Object.fromEntries(
          Object.entries(defaults).map(([action, combo]) => [action, rebaseCombo(combo, keymap.prefix, effective)]));
        const cache: HerdrCache = { prefix: keymap.prefix, prefixes: keymap.prefixes, defaults: rebased };
        localStorage.setItem(HERDR_CACHE_KEY, JSON.stringify(cache));
      } catch { /* Storage unavailable; stock defaults still apply. */ }
    }
    return getShortcuts();
  });
}

export function setPrefixOverride(prefix: string | undefined): void {
  try {
    if (prefix) localStorage.setItem(PREFIX_KEY, prefix);
    else localStorage.removeItem(PREFIX_KEY);
  } catch { /* Storage unavailable. */ }
}

// Drop custom overrides that exactly match a Herdr-provided combo, so those
// actions re-adopt the new prefix instead of going stale.
export function pruneOfferedOverrides(offered: string[]): void {
  try {
    const overrides = validOverrides(readStored(OVERRIDE_KEY));
    let changed = false;
    for (const [action, combo] of Object.entries(overrides)) {
      if (offered.includes(combo)) { delete overrides[action]; changed = true; }
    }
    if (changed) localStorage.setItem(OVERRIDE_KEY, JSON.stringify(overrides));
  } catch { /* Storage unavailable. */ }
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

// "close_pane" -> "Close pane" for dropdown labels.
const herdrActionOverrides: Record<string, string> = { goto: 'Go to' };
export function herdrActionLabel(action: string): string {
  const stock = action.endsWith(' (default)');
  const base = stock ? action.slice(0, -' (default)'.length) : action;
  const words = (herdrActionOverrides[base] ?? base).split('_');
  const friendly = words.map((word, index) => index === 0 && word ? word[0].toUpperCase() + word.slice(1) : word).join(' ');
  return stock ? `${friendly} (default)` : friendly;
}

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
