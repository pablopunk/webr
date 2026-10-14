import { isSequence, keyCombo, sequenceParts, type ShortcutAction } from '../components/shortcuts';

// Armed leader-prefix state, shared between the app handler (which arms it)
// and terminal panes (which must see it to pass a doubled prefix through).
let armedLeader: string | null = null;
let armedTimer: ReturnType<typeof setTimeout> | undefined;

export function armLeaderPrefix(combo: string, timeoutMs = 1500): void {
  armedLeader = combo;
  if (armedTimer) clearTimeout(armedTimer);
  armedTimer = setTimeout(() => { armedLeader = null; }, timeoutMs);
}

// Take a pending prefix, clearing it. Pure modifier presses must callers
// check keyCombo first: they must never consume the armed state.
export function takeLeaderPrefix(): string | null {
  const first = armedLeader;
  armedLeader = null;
  if (armedTimer) { clearTimeout(armedTimer); armedTimer = undefined; }
  return first;
}

export function peekLeaderPrefix(): string | null {
  return armedLeader;
}

// Ask the current thread's sidebar row to open its title editor.
export const RENAME_THREAD_EVENT = 'webr:rename-thread';
export function requestThreadRename(threadId: string): void {
  window.dispatchEvent(new CustomEvent<string>(RENAME_THREAD_EVENT, { detail: threadId }));
}

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
