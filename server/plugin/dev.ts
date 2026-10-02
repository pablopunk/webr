import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { realRun } from '../command';
import type { RunCommand } from '../command';
import { DEV_FILE, pluginStateDir } from './files';
import { readPluginConfig } from './config';
import { startNow } from './index';
import { probeAddress } from './probe';
import { stopPluginWebr } from './stop';
import { installFromGithub, installedPlugin, linkLocalPlugin, pluginConfigDir } from './herdr';

type Restore = () => void;
const nothingToRestore: Restore = () => {};

function restorePrevious(previous: ReturnType<typeof installedPlugin>, run: RunCommand) {
  if (previous?.kind === 'github') return installFromGithub(run);
  if (previous) return linkLocalPlugin(run, previous.root);
}

function startProduction(run: RunCommand, stateDir: string) {
  const plugin = installedPlugin(run);
  if (plugin) startNow(plugin.root, pluginConfigDir(run), { run, stateDir });
}

export async function stopProductionWebr(run: RunCommand = realRun, stateDir = pluginStateDir()) {
  if (!installedPlugin(run)) return false;
  const stopped = await stopPluginWebr(stateDir, probeAddress(readPluginConfig(pluginConfigDir(run))));
  if (stopped) console.log('Stopped the production Webr. It starts again when dev stops.');
  return stopped;
}

export function enterPluginDevMode(checkout: string, run: RunCommand = realRun, stateDir = pluginStateDir(), restartProduction = false): Restore {
  const previous = installedPlugin(run);
  if (!previous) return nothingToRestore;
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, DEV_FILE), JSON.stringify({ checkout, pid: process.pid }));
  linkLocalPlugin(run, join(checkout, 'plugin'));
  console.log('Webr plugin linked to this checkout. It is restored when dev stops.');
  return () => {
    rmSync(join(stateDir, DEV_FILE), { force: true });
    restorePrevious(previous, run);
    if (restartProduction) try { startProduction(run, stateDir); } catch { console.error('Could not start production Webr. Run "webr fix".'); }
  };
}
