import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { realRun } from '../command';
import type { RunCommand } from '../command';
import { DEV_FILE, pluginStateDir } from './files';
import { installFromGithub, installedPlugin, linkLocalPlugin } from './herdr';

type Restore = () => void;
const nothingToRestore: Restore = () => {};

function restorePrevious(previous: ReturnType<typeof installedPlugin>, run: RunCommand) {
  if (previous?.kind === 'github') return installFromGithub(run);
  if (previous) return linkLocalPlugin(run, previous.root);
}

export function enterPluginDevMode(checkout: string, run: RunCommand = realRun, stateDir = pluginStateDir()): Restore {
  const previous = installedPlugin(run);
  if (!previous) return nothingToRestore;
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, DEV_FILE), JSON.stringify({ checkout }));
  linkLocalPlugin(run, join(checkout, 'plugin'));
  console.log('Webr plugin linked to this checkout. It is restored when dev stops.');
  return () => {
    rmSync(join(stateDir, DEV_FILE), { force: true });
    restorePrevious(previous, run);
  };
}
