import { spawnSync } from 'node:child_process';
import { packageInfo } from '../package-info';
import { fetchLatestVersion, writeCachedLatest } from './latest';
import { detectPackageManager, globalInstallCommand, installedPackagePath, type InstallCommand } from './package-manager';
import { isNewerVersion } from './versions';

export type UpdateEnvironment = {
  installPath: () => string;
  latestVersion: (packageName: string) => Promise<string>;
  install: (command: InstallCommand) => boolean;
  installedVersion: () => string | undefined;
  restartPlugin: () => Promise<string[] | undefined>;
};

const installInTerminal = ({ command, args }: InstallCommand) => spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' }).status === 0;

const installedWebrVersion = () => {
  const result = spawnSync('webr', ['--version'], { encoding: 'utf8', shell: process.platform === 'win32', env: { ...process.env, WEBR_NO_UPDATE_CHECK: '1' } });
  return result.status === 0 ? result.stdout.trim().split('\n')[0] : undefined;
};

export const realUpdateEnvironment = (restartPlugin: UpdateEnvironment['restartPlugin']): UpdateEnvironment => ({
  installPath: installedPackagePath,
  latestVersion: fetchLatestVersion,
  install: installInTerminal,
  installedVersion: installedWebrVersion,
  restartPlugin,
});

const restartedPlugin = async (environment: UpdateEnvironment) => (await environment.restartPlugin()) ?? ['Restart Herdr to use the new version.'];

export async function runUpdate(environment: UpdateEnvironment) {
  const { name, version } = packageInfo();
  const manager = detectPackageManager(environment.installPath());
  if (!manager) throw new Error('This copy of Webr was not installed globally, so it cannot update itself. If it is a git checkout, pull and rebuild it.');
  const latest = await environment.latestVersion(name);
  writeCachedLatest(latest);
  if (!isNewerVersion(latest, version)) return [`Webr ${version} is the latest version.`, ...(await restartedPlugin(environment))];
  const command = globalInstallCommand(manager, name, latest);
  if (!environment.install(command)) throw new Error(`${manager} could not install ${name}@${latest}. Run it yourself to see why: ${command.command} ${command.args.join(' ')}`);
  const installed = environment.installedVersion();
  if (installed !== latest) throw new Error(`${manager} finished, but Webr is still ${installed ?? 'unreadable'} instead of ${latest}. Its package cache may be stale. Run it yourself: ${command.command} ${command.args.join(' ')}`);
  return [`Updated Webr ${version} → ${latest}.`, ...(await restartedPlugin(environment))];
}
