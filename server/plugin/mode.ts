import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunCommand } from '../command';
import { DEV_FILE } from './files';
import { installedPlugin } from './herdr';
import { isAlive } from './stop';

export type PluginMode =
  | { kind: 'absent' }
  | { kind: 'production' }
  | { kind: 'dev'; checkout: string }
  | { kind: 'stuck'; where: string };

type DevRecord = { checkout?: string; pid?: number };

function readDevRecord(stateDir: string): DevRecord | undefined {
  try { return JSON.parse(readFileSync(join(stateDir, DEV_FILE), 'utf8')) as DevRecord; } catch { return undefined; }
}

const devIsRunning = (record: DevRecord) => record.pid === undefined || isAlive(record.pid);

function installedOrUndefined(run: RunCommand) {
  try { return installedPlugin(run); } catch { return undefined; }
}

export function pluginMode(run: RunCommand, stateDir: string): PluginMode {
  const plugin = installedOrUndefined(run);
  const record = readDevRecord(stateDir);
  if (record?.checkout && devIsRunning(record) && plugin?.kind === 'local') return { kind: 'dev', checkout: record.checkout };
  if (record?.checkout) return { kind: 'stuck', where: record.checkout };
  if (plugin?.kind === 'local') return { kind: 'stuck', where: plugin.root };
  return plugin ? { kind: 'production' } : { kind: 'absent' };
}

export function modeLines(mode: PluginMode) {
  if (mode.kind === 'production') return ['Mode: production (started by the Herdr plugin).'];
  if (mode.kind === 'dev') return [`Mode: dev, running from ${mode.checkout}. Stopping "pnpm dev" brings production back.`];
  if (mode.kind === 'stuck') return [`Mode: the plugin still points at ${mode.where} but dev is not running. Run "webr plugin install" to restore production.`];
  return [];
}
