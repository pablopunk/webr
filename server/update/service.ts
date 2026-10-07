import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { UpdateState, UpdateStatus, Updates } from '../../src/shared/update';
import { installedEntry } from '../entry';
import { webrHome } from '../home';
import { packageInfo } from '../package-info';
import { fetchLatestVersion, readCachedLatest, writeCachedLatest } from './latest';
import { updateCheckDisabled } from './hint';
import { detectPackageManager, installedPackagePath, isNpxRun } from './package-manager';
import { isNewerVersion } from './versions';

const REFRESH_MS = 15 * 60 * 1000;
const RESTART_GRACE_MS = 60 * 1000;
const LOG_LINES_SHOWN = 4;

export type UpdateCommand = { command: string; args: string[] };
type Exit = (code: number | null) => void;

export function updateCommand(installPath: string, name: string, subcommand = 'update'): UpdateCommand | undefined {
  if (detectPackageManager(installPath)) return { command: process.execPath, args: [installedEntry(), subcommand] };
  return isNpxRun(installPath) ? { command: 'npx', args: ['--yes', `${name}@latest`, subcommand] } : undefined;
}

const logPath = () => join(webrHome(), 'update.log');

function spawnDetached({ command, args }: UpdateCommand, onExit: Exit) {
  mkdirSync(webrHome(), { recursive: true });
  const log = openSync(logPath(), 'w');
  const child = spawn(command, args, { detached: true, stdio: ['ignore', log, log], windowsHide: true, env: { ...process.env, WEBR_NO_UPDATE_CHECK: '1' } });
  closeSync(log);
  child.once('error', () => onExit(null));
  child.once('exit', onExit);
  child.unref();
}

const logTail = () => {
  try { return readFileSync(logPath(), 'utf8').split('\n').filter((line) => line.trim() && !/ExperimentalWarning|trace-warnings/.test(line)).slice(-LOG_LINES_SHOWN).join('\n'); } catch { return ''; }
};

export type UpdateServiceDeps = {
  env?: NodeJS.ProcessEnv;
  command?: UpdateCommand | undefined;
  restartCommand?: UpdateCommand | undefined;
  run?: (command: UpdateCommand, onExit: Exit) => void;
  fetchLatest?: (name: string) => Promise<string>;
  tail?: () => string;
  restartGraceMs?: number;
};

export class UpdateService implements Updates {
  private state: UpdateState = 'idle';
  private error: string | undefined;
  private readonly env: NodeJS.ProcessEnv;
  private readonly command: UpdateCommand | undefined;
  private readonly restartCommand: UpdateCommand | undefined;
  private readonly name = packageInfo().name;

  constructor(private readonly deps: UpdateServiceDeps = {}) {
    this.env = deps.env ?? process.env;
    this.command = 'command' in deps ? deps.command : safely(() => updateCommand(installedPackagePath(), this.name));
    this.restartCommand = 'restartCommand' in deps ? deps.restartCommand : safely(() => updateCommand(installedPackagePath(), this.name, 'restart'));
  }

  watch() {
    if (updateCheckDisabled(this.env) || !this.command) return () => {};
    void this.refresh();
    const timer = setInterval(() => void this.refresh(), REFRESH_MS);
    timer.unref();
    return () => clearInterval(timer);
  }

  async refresh() {
    await this.fetchAndCache().catch(() => undefined);
  }

  async check(): Promise<UpdateStatus> {
    await this.fetchAndCache();
    return this.status();
  }

  private async fetchAndCache() {
    writeCachedLatest(await (this.deps.fetchLatest ?? fetchLatestVersion)(this.name), this.env);
  }

  status(): UpdateStatus {
    const { version: current } = packageInfo();
    const latest = readCachedLatest(this.env)?.latest ?? current;
    const available = !!this.command && !updateCheckDisabled(this.env) && isNewerVersion(latest, current);
    return { current, latest, available, state: this.state, ...(this.error ? { error: this.error } : {}) };
  }

  start(): UpdateStatus {
    if (this.state === 'updating' || !this.command || !this.status().available) return this.status();
    this.state = 'updating';
    this.error = undefined;
    (this.deps.run ?? spawnDetached)(this.command, (code) => this.finished(code));
    return this.status();
  }

  restart(): UpdateStatus {
    if (this.state === 'updating' || !this.restartCommand) return this.status();
    (this.deps.run ?? spawnDetached)(this.restartCommand, (code) => { if (code !== 0) this.fail('Webr could not restart.'); });
    return this.status();
  }

  private finished(code: number | null) {
    if (code === 0) return void this.failAfterGrace('Webr installed the update but did not restart. Restart Herdr to use it.');
    const output = (this.deps.tail ?? logTail)();
    this.fail(output ? `The update failed.\n${output}` : 'The update failed.');
  }

  private failAfterGrace(message: string) {
    setTimeout(() => this.fail(message), this.deps.restartGraceMs ?? RESTART_GRACE_MS).unref();
  }

  private fail(message: string) {
    this.state = 'failed';
    this.error = message;
  }
}

function safely<T>(read: () => T): T | undefined {
  try { return read(); } catch { return undefined; }
}
