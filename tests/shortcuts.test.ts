import { expect, it } from 'vitest';
import { formatShortcut, getEffectivePrefix, herdrActionLabel, herdrDefaultsForWebr, isReservedShortcut, keymapWithPrefix, rebaseCombo, shortcutSequence } from '../src/components/shortcuts';

const keymap = {
  prefix: 'ctrl+a',
  prefixes: ['ctrl+a'],
  bindings: {
    next_tab: ['shift+right'],
    previous_tab: ['shift+left'],
    focus_pane_right: ['ctrl+l'],
    focus_pane_left: ['ctrl+h'],
    focus_pane_down: ['ctrl+j'],
    focus_pane_up: ['ctrl+k'],
    toggle_sidebar: ['ctrl+a b'],
    new_tab: ['ctrl+a c'],
    rename_workspace: ['ctrl+a r'],
    split_vertical: ['ctrl+a v', 'ctrl+a ctrl+s'],
    close_pane: ['ctrl+a x'],
  },
  stock: {
    next_tab: ['ctrl+a n'],
    focus_pane_right: ['ctrl+a l'],
    rename_tab: ['ctrl+a shift+t'],
    rename_workspace: ['ctrl+a shift+w'],
  },
};

it('maps Webr actions to the resolved Herdr bindings', () => {
  expect(herdrDefaultsForWebr(keymap)).toEqual({
    nextThread: 'ctrl+j',
    previousThread: 'ctrl+k',
    nextPane: 'ctrl+l',
    previousPane: 'ctrl+h',
    toggleSidebar: 'ctrl+a b',
    newThread: 'ctrl+a c',
    openTerminal: 'ctrl+a v',
    closePane: 'ctrl+a x',
    renameThread: 'ctrl+a r',
    commandPalette: 'meta+k',
  });
});

it('formats prefix sequences and direct chords', () => {
  expect(formatShortcut('ctrl+a x')).toBe('⌃A X');
  expect(formatShortcut('shift+right')).toBe('⇧→');
  expect(formatShortcut('ctrl+h')).toBe('⌃H');
  expect(shortcutSequence('ctrl+a shift+x')).toEqual([['⌃', 'A'], ['⇧', 'X']]);
});

it('prettifies Herdr action names for dropdown labels', () => {
  expect(herdrActionLabel('close_pane')).toBe('Close pane');
  expect(herdrActionLabel('split_vertical')).toBe('Split vertical');
  expect(herdrActionLabel('goto')).toBe('Go to');
  expect(herdrActionLabel('copy_mode (default)')).toBe('Copy mode (default)');
});
it('rebases prefix sequences onto another prefix', () => {
  expect(rebaseCombo('ctrl+a x', 'ctrl+a', 'ctrl+space')).toBe('ctrl+space x');
  expect(rebaseCombo('ctrl+h', 'ctrl+a', 'ctrl+space')).toBe('ctrl+h');
  expect(rebaseCombo('ctrl+b n', 'ctrl+b', 'ctrl+b')).toBe('ctrl+b n');
});

it('re-expresses a keymap under another prefix', () => {
  const rebased = keymapWithPrefix(keymap, 'ctrl+space');
  expect(rebased.prefix).toBe('ctrl+space');
  expect(rebased.bindings.close_pane).toEqual(['ctrl+space x']);
  expect(rebased.bindings.focus_pane_right).toEqual(['ctrl+l']);
});

it('falls back to the stock prefix without storage', () => {
  expect(getEffectivePrefix()).toBe('ctrl+b');
});

it('reserves browser shortcuts but allows Herdr-style chords', () => {
  expect(isReservedShortcut('ctrl+w')).toBe(true);
  expect(isReservedShortcut('ctrl+a x')).toBe(false);
  expect(isReservedShortcut('shift+left')).toBe(false);
  expect(isReservedShortcut('ctrl+h')).toBe(false);
  expect(isReservedShortcut('x')).toBe(true);
});
