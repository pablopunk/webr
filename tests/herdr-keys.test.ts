import { expect, it } from 'vitest';
import { herdrToWebr, parseHerdrKeysToml, resolveHerdrKeymap } from '../src/server/herdr-keys';

it('parses the user prefix and key overrides', () => {
  const parsed = parseHerdrKeysToml([
    '[keys]',
    'prefix = "ctrl+a"',
    'focus_pane_left = "ctrl+h"',
    'split_vertical = ["prefix+v", "prefix+ctrl+v"]',
    'settings = ""',
    '',
  ].join('\n'));
  expect(parsed.prefix).toBe('ctrl+a');
  expect(parsed.keys.focus_pane_left).toBe('ctrl+h');
  expect(parsed.keys.split_vertical).toEqual(['prefix+v', 'prefix+ctrl+v']);
  expect(parsed.keys.settings).toBe('');
});

it('ignores custom command blocks outside [keys]', () => {
  const parsed = parseHerdrKeysToml([
    '[keys]',
    'prefix = "ctrl+a"',
    '[[keys.command]]',
    'key = "prefix+space"',
    'command = "hr"',
    '[ui]',
    'agent_panel_sort = "priority"',
    '',
  ].join('\n'));
  expect(parsed.prefix).toBe('ctrl+a');
  expect(parsed.keys).toEqual({});
});

it('converts Herdr bindings to Webr combos', () => {
  expect(herdrToWebr('prefix+v', 'ctrl+a')).toBe('ctrl+a v');
  expect(herdrToWebr('prefix+shift+x', 'ctrl+a')).toBe('ctrl+a shift+x');
  expect(herdrToWebr('prefix+ctrl+s', 'ctrl+a')).toBe('ctrl+a ctrl+s');
  expect(herdrToWebr('ctrl+h', 'ctrl+a')).toBe('ctrl+h');
  expect(herdrToWebr('shift+left', 'ctrl+a')).toBe('shift+left');
  expect(herdrToWebr('', 'ctrl+a')).toBeUndefined();
  expect(herdrToWebr('prefix+1..9', 'ctrl+a')).toBeUndefined();
});

it('resolves the user config over stock defaults with the active prefix', () => {
  const keymap = resolveHerdrKeymap(['[keys]', 'prefix = "ctrl+a"', 'focus_pane_right = "ctrl+l"', ''].join('\n'));
  expect(keymap.prefix).toBe('ctrl+a');
  expect(keymap.prefixes).toEqual(['ctrl+a']);
  expect(keymap.bindings.focus_pane_right).toEqual(['ctrl+l']);
  expect(keymap.bindings.split_vertical).toEqual(['ctrl+a v']);
  expect(keymap.bindings.close_pane).toEqual(['ctrl+a x']);
  expect(keymap.bindings.new_tab).toEqual(['ctrl+a c']);
  expect(keymap.bindings.toggle_sidebar).toEqual(['ctrl+a b']);
});

it('falls back to stock defaults without a config', () => {
  const keymap = resolveHerdrKeymap();
  expect(keymap.prefix).toBe('ctrl+b');
  expect(keymap.bindings.close_pane).toEqual(['ctrl+b x']);
});
