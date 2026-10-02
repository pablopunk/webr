import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { realRun, type RunCommand } from '../command';
import { readPluginConfig, writePluginConfig, type PluginConfig } from './config';
import { pluginStateDir } from './files';
import { isPortOpen, probeAddress } from './probe';
import { stopPluginWebr } from './stop';
import { installFromGithub, installedPlugin, pluginConfigDir, requireGit, requireHerdr, uninstallPlugin, unlinkLocalPlugin } from './herdr';

export type PluginDeps = {
  run: RunCommand;
  stateDir: string;
};

export const defaultDeps = (): PluginDeps => ({ run: realRun, stateDir: pluginStateDir() });

export const startNow = (root: string, configDir: string, deps: PluginDeps) =>
  deps.run(process.execPath, [join(root, 'launch.mjs')], { HERDR_PLUGIN_CONFIG_DIR: configDir, HERDR_PLUGIN_STATE_DIR: deps.stateDir }).output.trim();

export async function installPlugin(config: PluginConfig, deps: PluginDeps) {
  requireHerdr(deps.run);
  requireGit(deps.run);
  const configDir = pluginConfigDir(deps.run);
  writePluginConfig(configDir, config);
  installFromGithub(deps.run);
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

export async function restartPluginWebr(deps: PluginDeps) {
  if (!deps.run('herdr', ['--version']).ok) return undefined;
  const plugin = installedPlugin(deps.run);
  if (!plugin) return undefined;
  const configDir = pluginConfigDir(deps.run);
  const address = probeAddress(readPluginConfig(configDir));
  if ((await isPortOpen(address)) && !(await stopPluginWebr(deps.stateDir, address))) return [`Webr is running on port ${address.port} but the plugin did not start it. Stop it and run "webr plugin install" to use the new version.`];
  return [startNow(plugin.root, configDir, deps)];
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
    `Settings: ${JSON.stringify(config)}`,
    `Logs and state: ${deps.stateDir}`,
  ];
}
