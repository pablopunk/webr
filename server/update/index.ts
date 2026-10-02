import { spawnSync } from 'node:child_process';
import { packageInfo } from '../package-info';
import { fetchLatestVersion, writeCachedLatest } from './latest';
import { detectPackageManager, globalInstallCommand, installedPackagePath, type InstallCommand } from './package-manager';
import { isNewerVersion } from './versions';

export type UpdateEnvironment = {
  installPath: () => string;
  latestVersion: (packageName: string) => Promise<string>;
  install: (command: InstallCommand) => boolean;
  restartService: () => string[] | undefined;
};

const installInTerminal = ({ command, args }: InstallCommand) => spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' }).status === 0;

export const realUpdateEnvironment = (restartService: UpdateEnvironment['restartService']): UpdateEnvironment => ({
  installPath: installedPackagePath,
  latestVersion: fetchLatestVersion,
  install: installInTerminal,
  restartService,
});

export async function runUpdate(environment: UpdateEnvironment) {
  const { name, version } = packageInfo();
  const manager = detectPackageManager(environment.installPath());
  if (!manager) throw new Error('This copy of Webr was not installed globally, so it cannot update itself. If it is a git checkout, pull and rebuild it.');
  const latest = await environment.latestVersion(name);
  writeCachedLatest(latest);
  if (!isNewerVersion(latest, version)) return [`Webr ${version} is the latest version.`];
  const command = globalInstallCommand(manager, name);
  if (!environment.install(command)) throw new Error(`${manager} could not install ${name}@${latest}. Run it yourself to see why: ${command.command} ${command.args.join(' ')}`);
  return [`Updated Webr ${version} → ${latest}.`, ...(environment.restartService() ?? ['Restart Webr to use the new version.'])];
}
