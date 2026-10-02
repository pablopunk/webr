import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { webrHome } from '../home';
import { installedEntry } from './entry';
import { launchd } from './launchd';
import { systemd } from './systemd';
import { windows } from './windows';
import type { CommandResult, RunCommand, ServicePlatform, ServiceSpec } from './types';

const PERSISTED_ENV = ['PATH', 'XDG_CONFIG_HOME', 'HERDR_CONFIG_PATH', 'WEBR_HOME', 'WEBR_DATABASE', 'WEBR_TARGETS', 'WEBR_ORIGIN', 'WEBR_TLS_CERT', 'WEBR_TLS_KEY'];

export const realRun: RunCommand = (command, args, env): CommandResult => {
  const result = spawnSync(command, args, { encoding: 'utf8', env: env ? { ...process.env, ...env } : undefined });
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}${result.error?.message ?? ''}` };
};

export function platformFor(platform: NodeJS.Platform = process.platform): ServicePlatform {
  if (platform === 'darwin') return launchd;
  if (platform === 'linux') return systemd;
  if (platform === 'win32') return windows;
  throw new Error(`Running Webr as a service is not supported on ${platform}.`);
}

export function serviceSpec(args: string[], env: NodeJS.ProcessEnv = process.env): ServiceSpec {
  const persisted = Object.fromEntries(PERSISTED_ENV.flatMap((key) => env[key] ? [[key, env[key]!]] : []));
  const logPath = join(webrHome(env), 'logs', 'webr.log');
  return {
    nodePath: process.execPath,
    entry: installedEntry(),
    args,
    env: { ...persisted, HOME: env.HOME ?? homedir(), WEBR_LOG_FILE: logPath },
    userHome: homedir(),
    logPath,
  };
}

export type ServiceAction = 'install' | 'restart' | 'uninstall' | 'status';

export function runServiceAction(action: ServiceAction, args: string[], run: RunCommand = realRun, platform = platformFor(), spec = serviceSpec(args)) {
  if (action === 'install') return [...platform.install(spec, run), `Logs: ${spec.logPath}`];
  if (action === 'restart') return platform.restart(spec, run);
  if (action === 'uninstall') return platform.uninstall(spec, run);
  const status = platform.status(spec, run);
  return [status.installed ? `Installed (${platform.name}), ${status.running ? 'running' : 'not running'}.` : 'Not installed.'];
}

const supportedPlatform = () => { try { return platformFor(); } catch { return undefined; } };

export const isServiceInstalled = (run: RunCommand = realRun, platform = supportedPlatform(), spec = serviceSpec([])) => !!platform?.status(spec, run).installed;
