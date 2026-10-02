import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { PID_FILE } from './files';
import { isPortOpen } from './probe';

type Address = Parameters<typeof isPortOpen>[0];

const STOP_ATTEMPTS = 50;
const STOP_POLL_MS = 100;

const pidPath = (stateDir: string) => join(stateDir, PID_FILE);
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

function recordedPid(stateDir: string) {
  try {
    const pid = Number(readFileSync(pidPath(stateDir), 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch { return undefined; }
}

export function isAlive(pid: number) {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}

async function waitUntilClosed(address: Address) {
  for (let attempt = 0; attempt < STOP_ATTEMPTS; attempt++) {
    if (!(await isPortOpen(address))) return true;
    await sleep(STOP_POLL_MS);
  }
  return false;
}

export async function stopPluginWebr(stateDir: string, address: Address) {
  const pid = recordedPid(stateDir);
  rmSync(pidPath(stateDir), { force: true });
  if (!pid || !isAlive(pid) || !(await isPortOpen(address))) return false;
  process.kill(pid, 'SIGTERM');
  return waitUntilClosed(address);
}
