import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { demoThreads } from './demo';
import { startFakeHerdr } from './fake-herdr';
import { demoSnapshot } from './snapshot';
import { seedDatabase } from './seed';
import { prepareDemoWorkspace } from './workspace';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const READY_TIMEOUT_MS = 30_000;
const PREFERRED_PORT = 4321;
const FAKE_NETWORK = fileURLToPath(new URL('./fake-network.ts', import.meta.url));

const listenOn = (port: number) => new Promise<number>((resolve, reject) => { const probe = createServer(); probe.once('error', reject); probe.listen(port, () => { const { port: bound } = probe.address() as { port: number }; probe.close(() => resolve(bound)); }); });
const freePort = () => listenOn(PREFERRED_PORT).catch(() => listenOn(0));
const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const hasAllThreads = (url: string) => fetch(`${url}/api/runtime`).then((response) => response.json(), () => undefined).then((runtime) => runtime?.projections?.flatMap((projection: { threads: unknown[] }) => projection.threads).length === demoThreads.length, () => false);

async function waitUntilServing(url: string, server: ChildProcess) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error('webr exited before it was ready');
    if (await hasAllThreads(url)) return;
    await sleep(250);
  }
  throw new Error('webr did not start in time');
}

export type DemoEnvironment = { url: string; root: string; stop(): Promise<void> };

export async function startDemoEnvironment(): Promise<DemoEnvironment> {
  const root = await mkdtemp(join(tmpdir(), 'webr-shots-'));
  const paths = await prepareDemoWorkspace(root);
  const { WEBR_ORIGIN: _origin, ...inherited } = process.env;
  const env = { ...inherited, PATH: `${paths.bin}:${process.env.PATH}`, HOME: paths.home, HERDR_SOCKET_PATH: paths.socket, WEBR_HOME: paths.webrHome };
  Object.assign(process.env, { PATH: env.PATH, HERDR_SOCKET_PATH: paths.socket });
  const fakeHerdr = await startFakeHerdr(paths.socket, () => demoSnapshot(root));
  await seedDatabase(paths);
  const port = await freePort();
  const url = `http://localhost:${port}`;
  const server = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), '--import', FAKE_NETWORK, 'server/start.ts'], { cwd: REPO, env: { ...env, PORT: String(port), HOST: '0.0.0.0' }, stdio: 'inherit' });
  const stop = async () => { server.kill('SIGTERM'); await close(fakeHerdr); await rm(root, { recursive: true, force: true }); };
  try { await waitUntilServing(url, server); } catch (error) { await stop(); throw error; }
  return { url, root, stop };
}
