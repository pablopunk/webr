import { join } from 'node:path';
import { platformFor, realRun, serviceSpec } from '../service';
import type { RunCommand } from '../service/types';
import { readPluginConfig, writePluginConfig, type PluginConfig } from './config';
import { pluginStateDir } from './files';
import { isPortOpen, probeAddress } from './probe';
import { installFromGithub, installedPlugin, pluginConfigDir, requireHerdr, uninstallPlugin, unlinkLocalPlugin } from './herdr';

export type PluginDeps = {
  run: RunCommand;
  serviceInstalled: () => boolean;
  confirm: (question: string) => Promise<boolean>;
  stateDir: string;
};

const SERVICE_WARNING = 'Webr is also installed as a background service. Two supervisors would fight over the same port.';

export const defaultServiceInstalled = () => {
  try { return platformFor().status(serviceSpec([]), realRun).installed; } catch { return false; }
};

export const defaultDeps = (confirm: PluginDeps['confirm']): PluginDeps => ({ run: realRun, serviceInstalled: defaultServiceInstalled, confirm, stateDir: pluginStateDir() });

async function offerToRemoveService(deps: PluginDeps) {
  if (!deps.serviceInstalled()) return [];
  if (!(await deps.confirm(`${SERVICE_WARNING}\nRemove the background service now?`))) return [SERVICE_WARNING, 'Remove it with "webr service uninstall".'];
  return platformFor().uninstall(serviceSpec([]), deps.run);
}

const startNow = (root: string, configDir: string, deps: PluginDeps) =>
  deps.run(process.execPath, [join(root, 'launch.mjs')], { HERDR_PLUGIN_CONFIG_DIR: configDir, HERDR_PLUGIN_STATE_DIR: deps.stateDir }).output.trim();

export async function installPlugin(config: PluginConfig, deps: PluginDeps) {
  requireHerdr(deps.run);
  const configDir = pluginConfigDir(deps.run);
  writePluginConfig(configDir, config);
  installFromGithub(deps.run);
  const plugin = installedPlugin(deps.run);
  if (!plugin) throw new Error('Herdr did not register the Webr plugin.');
  return [
    'Installed the Webr plugin. It starts Webr whenever the Herdr server starts.',
    ...(await offerToRemoveService(deps)),
    startNow(plugin.root, configDir, deps),
  ];
}

export function uninstallWebrPlugin(deps: PluginDeps) {
  requireHerdr(deps.run);
  const plugin = installedPlugin(deps.run);
  if (!plugin) return ['The Webr plugin is not installed.'];
  if (plugin.kind === 'github') uninstallPlugin(deps.run); else unlinkLocalPlugin(deps.run);
  return ['Removed the Webr plugin. A running Webr keeps running until you stop it.'];
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
    ...(deps.serviceInstalled() ? [SERVICE_WARNING] : []),
  ];
}
