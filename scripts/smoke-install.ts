import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import { parseArgs } from 'node:util';

const run = promisify(execFile);
const REMOTE_HEADERS = { 'X-Forwarded-For': '203.0.113.9' };
const INSTALLERS = ['npm', 'pnpm', 'bun'] as const;
type Installer = (typeof INSTALLERS)[number];

type Sandbox = { root: string; env: NodeJS.ProcessEnv; binDir: string };

const installCommands: Record<Installer, (tarball: string, sandbox: Sandbox) => { command: string; args: string[]; env: NodeJS.ProcessEnv; binDir: string }> = {
  npm: (tarball, { root }) => ({ command: 'npm', args: ['install', '--global', '--prefix', join(root, 'npm'), tarball], env: {}, binDir: join(root, 'npm', 'bin') }),
  pnpm: (tarball, { root }) => ({ command: 'pnpm', args: ['add', '--global', tarball], env: { PNPM_HOME: join(root, 'pnpm') }, binDir: join(root, 'pnpm', 'bin') }),
  bun: (tarball, { root }) => ({ command: 'bun', args: ['add', '--global', tarball], env: { BUN_INSTALL: join(root, 'bun') }, binDir: join(root, 'bun', 'bin') }),
};

const step = (message: string) => console.log(`• ${message}`);

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function packTarball(directory: string) {
  await run('pnpm', ['pack', '--pack-destination', directory], { maxBuffer: 16 * 1024 * 1024 });
  const [file] = (await readdir(directory)).filter((name) => name.endsWith('.tgz'));
  if (!file) throw new Error('pnpm pack produced no tarball');
  return join(directory, file);
}

async function waitForServer(origin: string, server: ChildProcess, output: () => string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`webr exited with ${server.exitCode}\n${output()}`);
    if (await fetch(`${origin}/api/auth/state`).then((response) => response.ok, () => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`webr did not become ready\n${output()}`);
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Expected ${message}`);
}

async function json(origin: string, path: string, init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) {
  const response = await fetch(origin + path, {
    method: init.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', Origin: origin, ...init.headers },
    body: init.method === 'POST' ? JSON.stringify(init.body ?? {}) : undefined,
  });
  return { status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0], body: await response.json().catch(() => undefined) as any };
}

async function verifyPairing(origin: string) {
  const runtime = await json(origin, '/api/runtime', { headers: REMOTE_HEADERS });
  expect(runtime.status === 401, 'a remote device without a session to be rejected');
  const request = await json(origin, '/api/pair/request', { method: 'POST', headers: REMOTE_HEADERS });
  expect(request.status === 200 && request.body.id, 'a pairing request to be created');
  const pending = await json(origin, '/api/pair/pending');
  expect(pending.body.some((entry: { id: string }) => entry.id === request.body.id), 'the request to be pending on the host');
  const approval = await json(origin, `/api/pair/${request.body.id}/approve`, { method: 'POST', body: {} });
  expect(approval.status === 200, 'the host to approve the request');
  const claim = await json(origin, `/api/pair/request/${request.body.id}/poll`, { method: 'POST', headers: REMOTE_HEADERS, body: { secret: request.body.secret } });
  expect(claim.body.status === 'approved' && claim.cookie, 'the device to receive a session');
  const authorized = await json(origin, '/api/runtime', { headers: { ...REMOTE_HEADERS, Cookie: claim.cookie! } });
  expect(authorized.status === 200, 'the paired device to read /api/runtime');
}

async function verifyInstaller(installer: Installer, tarball: string, root: string) {
  step(`${installer}: install ${tarball}`);
  const sandbox: Sandbox = { root, env: {}, binDir: '' };
  const install = installCommands[installer](tarball, sandbox);
  const env = { ...process.env, ...install.env, WEBR_HOME: join(root, 'webr-home'), PATH: [install.binDir, process.env.PATH].join(delimiter) };
  await run(install.command, install.args, { env, maxBuffer: 16 * 1024 * 1024 });
  const version = (await run('webr', ['--version'], { env })).stdout.trim();
  expect(/^\d+\.\d+\.\d+/.test(version), `webr --version to print a version, got "${version}"`);
  const port = await freePort();
  const origin = `http://localhost:${port}`;
  step(`${installer}: webr ${version} start --port ${port}`);
  const server = spawn('webr', ['start', '--port', String(port)], { env });
  let log = '';
  for (const stream of [server.stdout, server.stderr]) stream.on('data', (chunk) => { log += chunk; });
  try {
    await waitForServer(origin, server, () => log);
    expect((await json(origin, '/api/runtime')).status === 200, 'loopback /api/runtime to answer without a token');
    await verifyPairing(origin);
  } finally { server.kill('SIGTERM'); }
}

async function main() {
  const { values } = parseArgs({ options: { installers: { type: 'string', default: INSTALLERS.join(',') }, tarball: { type: 'string' } } });
  const installers = values.installers!.split(',').map((name) => name.trim()).filter(Boolean) as Installer[];
  for (const installer of installers) if (!INSTALLERS.includes(installer)) throw new Error(`Unknown installer "${installer}"`);
  const workspace = await mkdtemp(join(tmpdir(), 'webr-smoke-'));
  try {
    const tarball = values.tarball ?? await packTarball(workspace);
    for (const installer of installers) await verifyInstaller(installer, tarball, await mkdtemp(join(workspace, `${installer}-`)));
    console.log(`PASS: ${installers.join(', ')}`);
  } finally { await rm(workspace, { recursive: true, force: true }); }
}

await main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
