import { execFileSync, spawn } from 'node:child_process';
import { serverPort } from '../server/port';

const port = serverPort();
const STOP_TIMEOUT_MS = 5000;

const output = (command: string, args: string[]) => { try { return execFileSync(command, args, { encoding: 'utf8' }).trim(); } catch { return ''; } };
const listeningPids = () => output('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']).split('\n').filter(Boolean).map(Number);
const commandOf = (pid: number) => output('ps', ['-o', 'command=', '-p', String(pid)]);
const isWebrServer = (pid: number) => commandOf(pid).includes('server/start.ts');
const isAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

async function stopGently(pid: number) {
  process.kill(pid, 'SIGTERM');
  const end = Date.now() + STOP_TIMEOUT_MS;
  while (isAlive(pid) && Date.now() < end) await new Promise((done) => setTimeout(done, 100));
  if (isAlive(pid)) process.kill(pid, 'SIGKILL');
}

async function stopPreviousServer() {
  for (const pid of listeningPids()) {
    if (!isWebrServer(pid)) {
      console.error(`Port ${port} is used by another program (pid ${pid}: ${commandOf(pid)}). Stop it or choose another port with --port or PORT.`);
      process.exit(1);
    }
    console.log(`Stopping the previous Webr server on port ${port} (pid ${pid}).`);
    await stopGently(pid);
  }
}

await stopPreviousServer();
const server = spawn('pnpm', ['start'], { stdio: 'inherit', env: { ...process.env, PORT: String(port), WEBR_DEV: '1' } });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.kill(signal));
server.on('exit', (code) => process.exit(code ?? 0));
