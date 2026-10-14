import { expect, it } from 'vitest';
import { armLeaderPrefix, paletteToggle, peekLeaderPrefix, subscribeLeaderPrefix, takeLeaderPrefix } from '../src/client/keyboard';
import { defaultShortcuts } from '../src/components/shortcuts';

it('toggles the palette on its shortcut, whether open or closed', () => {
  expect(paletteToggle(null, 'meta+k', defaultShortcuts)).toBe(true);
  expect(paletteToggle(null, 'ctrl+k', defaultShortcuts)).toBe(false);
});

it('supports sequences for the palette shortcut', () => {
  const shortcuts = { ...defaultShortcuts, commandPalette: 'ctrl+a p' };
  expect(paletteToggle('ctrl+a', 'p', shortcuts)).toBe(true);
  expect(paletteToggle('ctrl+a', 'a', shortcuts)).toBe(false);
  expect(paletteToggle('ctrl+a', 'x', shortcuts)).toBe(false);
  expect(paletteToggle(null, 'p', shortcuts)).toBe(false);
});

it('notifies leader subscribers on arm and take', () => {
  takeLeaderPrefix();
  const seen: (string | null)[] = [];
  const stop = subscribeLeaderPrefix((armed) => seen.push(armed));
  armLeaderPrefix('ctrl+a');
  expect(peekLeaderPrefix()).toBe('ctrl+a');
  takeLeaderPrefix();
  expect(peekLeaderPrefix()).toBeNull();
  stop();
  armLeaderPrefix('ctrl+b');
  takeLeaderPrefix();
  expect(seen).toEqual(['ctrl+a', null]);
});
