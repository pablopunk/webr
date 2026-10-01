import { keyCombo, type ShortcutAction } from '../components/shortcuts';
export function appShortcutAction(event: KeyboardEvent, shortcuts: Record<ShortcutAction, string>) {
  if (event.repeat || event.defaultPrevented || event.isComposing) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest('[data-recording="true"]')) return;
  if (target?.closest('input, textarea, select, [contenteditable="true"]') && !target.closest('.xterm, .terminal-input-capture')) return;
  return Object.entries(shortcuts).find(([, combo]) => combo === keyCombo(event))?.[0] as ShortcutAction | undefined;
}
