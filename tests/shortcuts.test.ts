import { expect, it } from 'vitest';
import { formatShortcut, herdrDefaultsForWebr, isReservedShortcut, shortcutSequence } from '../src/components/shortcuts';

const keymap = {
  prefix: 'ctrl+a',
  prefixes: ['ctrl+a'],
  bindings: {
    next_tab: ['shift+right'],
    previous_tab: ['shift+left'],
    focus_pane_right: ['ctrl+l'],
    focus_pane_left: ['ctrl+h'],
    toggle_sidebar: ['ctrl+a b'],
    new_tab: ['ctrl+a c'],
    split_vertical: ['ctrl+a v', 'ctrl+a ctrl+s'],
    close_pane: ['ctrl+a x'],
  },
  stock: {
    next_tab: ['ctrl+a n'],
    focus_pane_right: ['ctrl+a l'],
  },
};

it('maps Webr actions to the resolved Herdr bindings', () => {
  expect(herdrDefaultsForWebr(keymap)).toEqual({
    nextThread: 'shift+right',
    previousThread: 'shift+left',
    nextPane: 'ctrl+l',
    previousPane: 'ctrl+h',
    toggleSidebar: 'ctrl+a b',
    newThread: 'ctrl+a c',
    openTerminal: 'ctrl+a v',
    closePane: 'ctrl+a x',
  });
});

it('formats prefix sequences and direct chords', () => {
  expect(formatShortcut('ctrl+a x')).toBe('⌃A X');
  expect(formatShortcut('shift+right')).toBe('⇧→');
  expect(formatShortcut('ctrl+h')).toBe('⌃H');
  expect(shortcutSequence('ctrl+a shift+x')).toEqual([['⌃', 'A'], ['⇧', 'X']]);
});

it('reserves browser shortcuts but allows Herdr-style chords', () => {
  expect(isReservedShortcut('ctrl+w')).toBe(true);
  expect(isReservedShortcut('ctrl+a x')).toBe(false);
  expect(isReservedShortcut('shift+left')).toBe(false);
  expect(isReservedShortcut('ctrl+h')).toBe(false);
  expect(isReservedShortcut('x')).toBe(true);
});
