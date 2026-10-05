import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type PackageManager = 'npm' | 'pnpm' | 'bun';
export type InstallCommand = { command: string; args: string[] };

const isInsideNodeModules = (path: string) => /[\\/]node_modules[\\/]/.test(path);
const isBunInstall = (path: string) => /[\\/]\.bun[\\/]/.test(path);
const isPnpmInstall = (path: string) => /[\\/]pnpm[\\/]/.test(path) || /[\\/]\.pnpm[\\/]/.test(path);

export const isNpxRun = (path: string) => /[\\/]_npx[\\/]/.test(path);

export function detectPackageManager(installPath: string): PackageManager | undefined {
  if (isNpxRun(installPath) || !isInsideNodeModules(installPath)) return undefined;
  if (isBunInstall(installPath)) return 'bun';
  return isPnpmInstall(installPath) ? 'pnpm' : 'npm';
}

export const installedPackagePath = () => realpathSync(fileURLToPath(new URL('../../package.json', import.meta.url)));

export function globalInstallCommand(manager: PackageManager, packageName: string, version: string): InstallCommand {
  const target = `${packageName}@${version}`;
  if (manager === 'pnpm') return { command: 'pnpm', args: ['add', '-g', target] };
  if (manager === 'bun') return { command: 'bun', args: ['add', '-g', '--no-cache', target] };
  return { command: 'npm', args: ['install', '-g', target] };
}
