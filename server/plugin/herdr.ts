import type { CommandResult, RunCommand } from '../command';

export const PLUGIN_ID = 'pablopunk.webr';
export const PLUGIN_SOURCE = 'pablopunk/webr/plugin';

export type InstalledPlugin = { root: string; kind: 'github' | 'local' };

const succeeded = (result: CommandResult, action: string) => {
  if (!result.ok) throw new Error(`herdr could not ${action}: ${result.output.trim()}`);
  return result.output;
};

export function installedPlugin(run: RunCommand): InstalledPlugin | undefined {
  const result = run('herdr', ['plugin', 'list', '--json']);
  if (!result.ok) return undefined;
  const plugins = (JSON.parse(result.output) as { result: { plugins: { plugin_id: string; plugin_root: string; source: { kind: InstalledPlugin['kind'] } }[] } }).result.plugins;
  const found = plugins.find((plugin) => plugin.plugin_id === PLUGIN_ID);
  return found && { root: found.plugin_root, kind: found.source.kind };
}

export const requireHerdr = (run: RunCommand) => {
  if (!run('herdr', ['--version']).ok) throw new Error('Herdr is not installed or not on your PATH. Install it from https://herdr.dev first.');
};

export const requireGit = (run: RunCommand) => {
  if (!run('git', ['--version']).ok) throw new Error('Git is not installed or not on your PATH. Herdr needs it to install plugins from GitHub.');
};

export const pluginConfigDir = (run: RunCommand) => succeeded(run('herdr', ['plugin', 'config-dir', PLUGIN_ID]), 'find the plugin config folder').trim();
export const installFromGithub = (run: RunCommand) => succeeded(run('herdr', ['plugin', 'install', PLUGIN_SOURCE, '--yes']), 'install the plugin');
export const uninstallPlugin = (run: RunCommand) => succeeded(run('herdr', ['plugin', 'uninstall', PLUGIN_ID]), 'uninstall the plugin');
export const linkLocalPlugin = (run: RunCommand, directory: string) => succeeded(run('herdr', ['plugin', 'link', directory]), 'link the plugin');
export const unlinkLocalPlugin = (run: RunCommand) => succeeded(run('herdr', ['plugin', 'unlink', PLUGIN_ID]), 'unlink the plugin');

export function replaceWithGithub(run: RunCommand) {
  if (installedPlugin(run)?.kind === 'local') unlinkLocalPlugin(run);
  installFromGithub(run);
}
