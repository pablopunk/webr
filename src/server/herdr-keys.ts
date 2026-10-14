import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';

// Stock Herdr 0.9.3 [keys] defaults, taken from `herdr --default-config`.
// This is the fallback when the user config is missing or omits an action.
export const HERDR_STOCK_PREFIX = 'ctrl+b';
export const HERDR_STOCK_KEYS: Record<string, string[]> = {
  help: ['prefix+?'],
  settings: ['prefix+s'],
  detach: ['prefix+q'],
  reload_config: ['prefix+shift+r'],
  open_notification_target: ['prefix+o'],
  workspace_picker: ['prefix+w'],
  goto: ['prefix+g'],
  new_workspace: ['prefix+shift+n'],
  new_worktree: ['prefix+shift+g'],
  rename_workspace: ['prefix+shift+w'],
  close_workspace: ['prefix+shift+d'],
  copy_mode: ['prefix+['],
  remote_image_paste: ['ctrl+v'],
  new_tab: ['prefix+c'],
  rename_tab: ['prefix+shift+t'],
  previous_tab: ['prefix+p'],
  next_tab: ['prefix+n'],
  close_tab: ['prefix+shift+x'],
  rename_pane: ['prefix+shift+p'],
  edit_scrollback: ['prefix+e'],
  focus_pane_left: ['prefix+h'],
  focus_pane_down: ['prefix+j'],
  focus_pane_up: ['prefix+k'],
  focus_pane_right: ['prefix+l'],
  cycle_pane_next: ['prefix+tab'],
  cycle_pane_previous: ['prefix+shift+tab'],
  split_vertical: ['prefix+v'],
  split_horizontal: ['prefix+minus'],
  close_pane: ['prefix+x'],
  zoom: ['prefix+z'],
  resize_mode: ['prefix+r'],
  toggle_sidebar: ['prefix+b'],
};

export type HerdrKeymapResponse = {
  prefix: string;
  prefixes: string[];
  /** Resolved bindings (user config over stock), converted to Webr combo syntax. */
  bindings: Record<string, string[]>;
  /** Stock defaults converted with the active prefix, so the UI can offer the prefix form too. */
  stock: Record<string, string[]>;
};

const sectionHeader = /^\s*\[([^\]]+)\]\s*(?:#.*)?$/;
const assignment = /^\s*([A-Za-z0-9_]+)\s*=\s*(.+?)\s*$/;
const quoted = /"((?:[^"\\]|\\.)*)"/g;
const unescape = (value: string) => value.replace(/\\(.)/g, '$1');

// Minimal TOML reader for the [keys] table only. It deliberately ignores
// [[keys.command]] blocks and everything outside [keys].
export function parseHerdrKeysToml(text: string): { prefix?: string | string[]; keys: Record<string, string | string[]> } {
  let inKeys = false;
  let prefix: string | string[] | undefined;
  const keys: Record<string, string | string[]> = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[[')) { inKeys = false; continue; }
    const section = sectionHeader.exec(line);
    if (section) { inKeys = section[1].trim() === 'keys'; continue; }
    if (!inKeys) continue;
    const assign = assignment.exec(line);
    if (!assign) continue;
    const value = assign[2].split('#')[0].trim();
    if (value.startsWith('[')) {
      const items = [...value.matchAll(quoted)].map((match) => unescape(match[1]));
      if (assign[1] === 'prefix') prefix = items;
      else keys[assign[1]] = items;
    } else {
      const single = /^"((?:[^"\\]|\\.)*)"/.exec(value)?.[1];
      if (single === undefined) continue;
      if (assign[1] === 'prefix') prefix = unescape(single);
      else keys[assign[1]] = unescape(single);
    }
  }
  return { prefix, keys };
}

const toArray = (value: string | string[]): string[] => (Array.isArray(value) ? value : [value]);

// Convert one raw Herdr binding to Webr combo syntax ("prefix+v" with a
// "ctrl+a" prefix becomes the two-step sequence "ctrl+a v").
// Returns undefined for unset ("") and indexed ("prefix+1..9") bindings.
export function herdrToWebr(raw: string, prefix: string): string | undefined {
  const value = raw.trim().toLowerCase();
  if (!value || value.includes('..')) return undefined;
  const parts = value.split('+');
  if (parts[0] === 'prefix') {
    const second = parts.slice(1).join('+');
    if (!second) return prefix;
    return `${prefix} ${second}`;
  }
  return value;
}

export function resolveHerdrKeymap(configText?: string): HerdrKeymapResponse {
  const parsed = configText ? parseHerdrKeysToml(configText) : undefined;
  const prefixes = parsed?.prefix !== undefined ? toArray(parsed.prefix).filter(Boolean) : [HERDR_STOCK_PREFIX];
  const primary = prefixes[0] ?? HERDR_STOCK_PREFIX;
  const merged: Record<string, string[]> = { ...HERDR_STOCK_KEYS };
  if (parsed) for (const [name, value] of Object.entries(parsed.keys)) merged[name] = toArray(value);
  const convert = (raw: string) => herdrToWebr(raw, primary);
  const bindings: Record<string, string[]> = {};
  for (const [name, raws] of Object.entries(merged)) bindings[name] = raws.map(convert).filter((combo): combo is string => !!combo);
  const stock: Record<string, string[]> = {};
  for (const [name, raws] of Object.entries(HERDR_STOCK_KEYS)) stock[name] = raws.map(convert).filter((combo): combo is string => !!combo);
  return { prefix: primary, prefixes, bindings, stock };
}

export function herdrConfigPath(env = process.env): string {
  return env.HERDR_CONFIG_PATH ?? join(env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'herdr', 'config.toml');
}

export async function loadHerdrKeymap(
  env = process.env,
  read: (path: string, encoding: 'utf8') => Promise<string> = (path, encoding) => readFile(path, encoding),
): Promise<HerdrKeymapResponse> {
  try {
    return resolveHerdrKeymap(await read(herdrConfigPath(env), 'utf8'));
  } catch {
    return resolveHerdrKeymap();
  }
}
