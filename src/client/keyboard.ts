import { isSequence, keyCombo, sequenceParts, type ShortcutAction } from '../components/shortcuts';

export function appShortcutAction(event: KeyboardEvent, shortcuts: Record<ShortcutAction, string>) {
  if (event.repeat || event.defaultPrevented || event.isComposing) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest('[data-recording="true"]')) return;
  if (target?.closest('input, textarea, select, [contenteditable="true"]') && !target.closest('.xterm, .terminal-input-capture')) return;
  const combo = keyCombo(event);
  return Object.entries(shortcuts).find(([, value]) => !isSequence(value) && value === combo)?.[0] as ShortcutAction | undefined;
}

// First chords that arm the leader key (e.g. "ctrl+a" in "ctrl+a x").
export function sequenceStarters(shortcuts: Record<ShortcutAction, string>): Set<string> {
  return new Set(Object.values(shortcuts).filter(isSequence).map((value) => sequenceParts(value)[0]));
}

export function sequenceAction(first: string, second: string, shortcuts: Record<ShortcutAction, string>): ShortcutAction | undefined {
  if (!first || !second) return undefined;
  return Object.entries(shortcuts).find(([, value]) => value === `${first} ${second}`)?.[0] as ShortcutAction | undefined;
}

// True when a keydown participates in any app shortcut (single chord, prefix
// starter, or sequence second step). Terminals defer such keys to the app
// instead of sending them to the shell.
export function shortcutInvolves(combo: string, shortcuts: Record<ShortcutAction, string>): boolean {
  if (!combo) return false;
  return Object.values(shortcuts).some((value) =>
    value === combo || (isSequence(value) && sequenceParts(value).includes(combo)));
}
