import { realpathSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { realRun, type RunCommand } from '../command';
import { readPluginConfig, writePluginConfig, type PluginConfig, type SavedLauncher } from './config';
import { pluginStateDir } from './files';
import { isPortOpen, probeAddress } from './probe';
import { stopPluginWebr } from './stop';
import { modeLines, pluginMode } from './mode';
import { DEV_FILE } from './files';
import { installedPlugin, replaceWithGithub, pluginConfigDir, requireGit, requireHerdr, uninstallPlugin, unlinkLocalPlugin } from './herdr';

export type PluginDeps = {
  run: RunCommand;
  stateDir: string;
  launcher?: SavedLauncher;
};

function runningLauncher(): SavedLauncher | undefined {
  try {
    const entry = realpathSync(process.argv[1]!);
    return basename(entry) === 'webr.mjs' ? { node: process.execPath, entry } : undefined;
  } catch { return undefined; }
}

export const defaultDeps = (): PluginDeps => ({ run: realRun, stateDir: pluginStateDir(), launcher: runningLauncher() });

export const startNow = (root: string, configDir: string, deps: PluginDeps) =>
  deps.run(process.execPath, [join(root, 'launch.mjs')], { HERDR_PLUGIN_CONFIG_DIR: configDir, HERDR_PLUGIN_STATE_DIR: deps.stateDir }).output.trim();

export async function installPlugin(config: PluginConfig, deps: PluginDeps) {
  requireHerdr(deps.run);
  requireGit(deps.run);
  if (pluginMode(deps.run, deps.stateDir).kind === 'dev') throw new Error('"pnpm dev" is running. Stop it with Ctrl+C first; production comes back by itself.');
  const configDir = pluginConfigDir(deps.run);
  writePluginConfig(configDir, { ...readPluginConfig(configDir), ...config, ...(deps.launcher ? { launcher: deps.launcher } : {}) });
  rmSync(join(deps.stateDir, DEV_FILE), { force: true });
  replaceWithGithub(deps.run);
  const plugin = installedPlugin(deps.run);
  if (!plugin) throw new Error('Herdr did not register the Webr plugin.');
  return [
    'Installed the Webr plugin. It starts Webr whenever the Herdr server starts.',
    startNow(plugin.root, configDir, deps),
  ];
}

export async function uninstallWebrPlugin(deps: PluginDeps) {
  requireHerdr(deps.run);
  const plugin = installedPlugin(deps.run);
  if (!plugin) return ['The Webr plugin is not installed.'];
  const configDir = pluginConfigDir(deps.run);
  const stopped = await stopPluginWebr(deps.stateDir, probeAddress(readPluginConfig(configDir)));
  if (plugin.kind === 'github') uninstallPlugin(deps.run); else unlinkLocalPlugin(deps.run);
  rmSync(configDir, { recursive: true, force: true });
  rmSync(deps.stateDir, { recursive: true, force: true });
  return ['Removed the Webr plugin.', ...(stopped ? ['Stopped the running Webr.'] : [])];
}

const quiet = (output: string) => output.split('\n').filter((line) => line.trim() && !/ExperimentalWarning|trace-warnings/.test(line));

export async function updatePlugin(deps: PluginDeps) {
  if (!deps.run('herdr', ['--version']).ok) return undefined;
  if (!installedPlugin(deps.run)) return undefined;
  const address = probeAddress(readPluginConfig(pluginConfigDir(deps.run)));
  if ((await isPortOpen(address)) && !(await stopPluginWebr(deps.stateDir, address))) return [`Webr is running on port ${address.port} but the plugin did not start it. Stop it and run "webr plugin install" to use the new version.`];
  const refreshed = deps.run('webr', ['plugin', 'install']);
  return refreshed.ok ? quiet(refreshed.output) : [`The new Webr could not refresh the plugin. Run "webr plugin install". ${quiet(refreshed.output).join(' ')}`];
}

export async function pluginStatus(deps: PluginDeps) {
  requireHerdr(deps.run);
  const plugin = installedPlugin(deps.run);
  if (!plugin) return ['The Webr plugin is not installed. Install it with "webr plugin install".'];
  const config = readPluginConfig(pluginConfigDir(deps.run));
  const address = probeAddress(config);
  return [
    `Installed (${plugin.kind === 'github' ? 'from GitHub' : `linked to ${plugin.root}`}).`,
    `Webr is ${await isPortOpen(address) ? 'running' : 'not running'} on port ${address.port}.`,
    ...modeLines(pluginMode(deps.run, deps.stateDir)),
    `Settings: ${JSON.stringify(config)}`,
    `Logs and state: ${deps.stateDir}`,
  ];
}
