import { spawn } from 'node:child_process';
import { statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { distRoot } from '../src/server/dist';

const POLL_MS = 2000;

const builtEntry = () => resolve(distRoot(), 'server/entry.mjs');
const builtAt = () => { try { return statSync(builtEntry()).mtimeMs; } catch { return undefined; } };

export const relaunchSelf = () => spawn(process.execPath, [...process.execArgv, ...process.argv.slice(1)], { detached: true, stdio: 'ignore', env: process.env }).unref();

export const recordPid = (stateDir: string | undefined, pidFile: string) => { if (stateDir) writeFileSync(resolve(stateDir, pidFile), String(process.pid)); };

export function restartWhenRebuilt(stop: () => Promise<void>, relaunch = relaunchSelf) {
  const startedAt = builtAt();
  if (startedAt === undefined) return () => {};
  const timer = setInterval(() => {
    const current = builtAt();
    if (current === undefined || current === startedAt) return;
    clearInterval(timer);
    console.log('Webr was updated on disk. Restarting to serve the new build.');
    void stop().finally(() => { relaunch(); process.exit(0); });
  }, POLL_MS);
  return () => clearInterval(timer);
}
