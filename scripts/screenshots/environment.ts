import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeHerdr } from './fake-herdr';
import { demoSnapshot } from './snapshot';
import { seedDatabase } from './seed';
import { prepareDemoWorkspace } from './workspace';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const READY_TIMEOUT_MS = 30_000;
const SHOWN_ORIGIN = 'https://my-mac.tail1234.ts.net';

const freePort = () => new Promise<number>((resolve) => { const probe = createServer(); probe.listen(0, () => { const { port } = probe.address() as { port: number }; probe.close(() => resolve(port)); }); });
const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntilServing(url: string, server: ChildProcess) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error('webr exited before it was ready');
    if (await fetch(`${url}/api/auth/state`).then((response) => response.ok, () => false)) return;
    await sleep(250);
  }
  throw new Error('webr did not start in time');
}

export type DemoEnvironment = { url: string; root: string; stop(): Promise<void> };

export async function startDemoEnvironment(): Promise<DemoEnvironment> {
  const root = await mkdtemp(join(tmpdir(), 'webr-shots-'));
  const paths = await prepareDemoWorkspace(root);
  const env = { ...process.env, PATH: `${paths.bin}:${process.env.PATH}`, HOME: paths.home, HERDR_SOCKET_PATH: paths.socket, WEBR_HOME: paths.webrHome };
  Object.assign(process.env, { PATH: env.PATH, HERDR_SOCKET_PATH: paths.socket });
  const fakeHerdr = await startFakeHerdr(paths.socket, () => demoSnapshot(root));
  await seedDatabase(paths);
  const port = await freePort();
  const url = `http://localhost:${port}`;
  const server = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), 'server/start.ts'], { cwd: REPO, env: { ...env, PORT: String(port), HOST: '127.0.0.1', WEBR_ORIGIN: SHOWN_ORIGIN }, stdio: 'inherit' });
  const stop = async () => { server.kill('SIGTERM'); await close(fakeHerdr); await rm(root, { recursive: true, force: true }); };
  try { await waitUntilServing(url, server); } catch (error) { await stop(); throw error; }
  return { url, root, stop };
}
