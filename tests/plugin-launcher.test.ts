import { afterEach, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as plan from '../plugin/plan.mjs';
import * as files from '../server/plugin/files';
import { probeAddress } from '../server/plugin/probe';

const launcher = fileURLToPath(new URL('../plugin/launch.mjs', import.meta.url));
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    try { process.kill(Number(readFileSync(join(root, 'state', 'webr.pid'), 'utf8')), 'SIGKILL'); } catch {}
    rmSync(root, { recursive: true, force: true });
  }
});

const fakeProgram = (path: string, record: string, label: string) => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `#!/bin/sh\necho "${label} $PORT $HOST $WEBR_ORIGIN $@" >> "${record}"\nexec sleep 30\n`);
  chmodSync(path, 0o755);
};

const freePort = () => new Promise<number>((done) => {
  const probe = createServer().listen(0, '127.0.0.1', () => { const { port } = probe.address() as { port: number }; probe.close(() => done(port)); });
});

async function sandbox(config: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'webr-launch-')); roots.push(root);
  const paths = { root, bin: join(root, 'bin'), config: join(root, 'config'), state: join(root, 'state'), record: join(root, 'record.txt') };
  mkdirSync(paths.config); mkdirSync(paths.state);
  const port = await freePort();
  writeFileSync(join(paths.config, 'config.json'), JSON.stringify({ port, ...config }));
  const launch = () => spawnSync(process.execPath, [launcher], { encoding: 'utf8', env: { PATH: `${paths.bin}:/usr/bin:/bin`, HERDR_PLUGIN_CONFIG_DIR: paths.config, HERDR_PLUGIN_STATE_DIR: paths.state } });
  const records = () => existsSync(paths.record) ? readFileSync(paths.record, 'utf8').trim().split('\n').map((line) => line.replace(/\s+/g, ' ')) : [];
  const recordsAfterStart = async () => { for (let i = 0; i < 50 && !records().length; i++) await new Promise((done) => setTimeout(done, 50)); return records(); };
  return { ...paths, port, launch, records, recordsAfterStart };
}

it('starts the webr found on PATH with the flags from the plugin config', async () => {
  const box = await sandbox({ host: '0.0.0.0', origin: 'https://mac.example.ts.net' });
  fakeProgram(join(box.bin, 'webr'), box.record, 'global');
  const result = box.launch();
  expect(result.stdout).toContain('Started Webr (global)');
  expect((await box.recordsAfterStart())[0]).toBe(`global start --port ${box.port} --host 0.0.0.0 --origin https://mac.example.ts.net`);
  expect(readFileSync(join(box.state, 'webr.pid'), 'utf8')).toMatch(/^\d+$/);
});

it('points the started Webr at a rotating log file in the plugin state folder', async () => {
  const box = await sandbox();
  mkdirSync(box.bin, { recursive: true });
  writeFileSync(join(box.bin, 'webr'), `#!/bin/sh\necho "$WEBR_LOG_FILE" >> "${box.record}"\nexec sleep 30\n`);
  chmodSync(join(box.bin, 'webr'), 0o755);
  box.launch();
  expect((await box.recordsAfterStart())[0]).toBe(join(box.state, 'webr.log'));
});

it('falls back to npx when webr is not on PATH', async () => {
  const box = await sandbox();
  fakeProgram(join(box.bin, 'npx'), box.record, 'npx');
  expect(box.launch().stdout).toContain('Started Webr (npx)');
  expect((await box.recordsAfterStart())[0]).toBe(`npx -y ${plan.PACKAGE_NAME} start --port ${box.port}`);
});

it('uses the launcher saved at install time when webr is not on PATH', async () => {
  const box = await sandbox();
  const node = join(box.root, 'saved', 'node'); const entry = join(box.root, 'saved', 'webr.mjs');
  fakeProgram(node, box.record, 'saved'); writeFileSync(entry, '');
  writeFileSync(join(box.config, 'config.json'), JSON.stringify({ port: box.port, launcher: { node, entry } }));
  expect(box.launch().stdout).toContain('Started Webr (saved)');
  expect((await box.recordsAfterStart())[0]).toBe(`saved ${entry} start --port ${box.port}`);
});

it('prefers webr on PATH over the saved launcher, and ignores a saved launcher that is gone', async () => {
  const onPath = await sandbox();
  fakeProgram(join(onPath.bin, 'webr'), onPath.record, 'global');
  writeFileSync(join(onPath.config, 'config.json'), JSON.stringify({ port: onPath.port, launcher: { node: '/x/node', entry: '/x/webr.mjs' } }));
  expect(onPath.launch().stdout).toContain('Started Webr (global)');
  const gone = await sandbox();
  fakeProgram(join(gone.bin, 'npx'), gone.record, 'npx');
  writeFileSync(join(gone.config, 'config.json'), JSON.stringify({ port: gone.port, launcher: { node: '/x/node', entry: '/x/webr.mjs' } }));
  expect(gone.launch().stdout).toContain('Started Webr (npx)');
});

it('replaces a recorded process that is alive but not serving the configured port', async () => {
  const box = await sandbox();
  fakeProgram(join(box.bin, 'webr'), box.record, 'global');
  box.launch();
  await box.recordsAfterStart();
  const stale = Number(readFileSync(join(box.state, 'webr.pid'), 'utf8'));
  const second = box.launch();
  expect(second.stdout).toContain('Started Webr (global)');
  expect(Number(readFileSync(join(box.state, 'webr.pid'), 'utf8'))).not.toBe(stale);
});

it('exits quietly when something already listens on the configured port', async () => {
  const box = await sandbox();
  fakeProgram(join(box.bin, 'webr'), box.record, 'global');
  const listener = createServer().listen(box.port, '127.0.0.1');
  await new Promise((done) => listener.once('listening', done));
  const result = await new Promise<ReturnType<typeof box.launch>>((done) => setImmediate(() => done(box.launch())));
  listener.close();
  expect(result.stdout).toContain('already running');
  expect(box.records()).toEqual([]);
});

it('starts the dev checkout instead of the global webr while dev mode is recorded', async () => {
  const box = await sandbox();
  fakeProgram(join(box.bin, 'webr'), box.record, 'global');
  const checkout = join(box.root, 'checkout');
  fakeProgram(plan.devTsx(checkout), box.record, 'checkout');
  writeFileSync(join(box.state, 'dev.json'), JSON.stringify({ checkout }));
  expect(box.launch().stdout).toContain('Started Webr (checkout)');
  expect((await box.recordsAfterStart())[0]).toBe(`checkout ${box.port} server/start.ts`);
});

it('ignores a dev record whose dev process has died', async () => {
  const box = await sandbox();
  fakeProgram(join(box.bin, 'webr'), box.record, 'global');
  const checkout = join(box.root, 'checkout');
  fakeProgram(plan.devTsx(checkout), box.record, 'checkout');
  const dead = spawnSync(process.execPath, ['-e', '']).pid!;
  writeFileSync(join(box.state, 'dev.json'), JSON.stringify({ checkout, pid: dead }));
  expect(box.launch().stdout).toContain('Started Webr (global)');
});

it('ignores a stale dev record whose checkout is gone', async () => {
  const box = await sandbox();
  fakeProgram(join(box.bin, 'webr'), box.record, 'global');
  writeFileSync(join(box.state, 'dev.json'), JSON.stringify({ checkout: join(box.root, 'deleted') }));
  expect(box.launch().stdout).toContain('Started Webr (global)');
});

it('plans nothing when Webr is running, whatever the mode', () => {
  expect(plan.launchPlan({ config: {}, devCheckout: '/dev', webrPath: '/bin/webr', savedLauncher: undefined, running: true })).toEqual({ action: 'skip' });
});

it('agrees with the CLI on file names and the probed address', () => {
  expect([plan.CONFIG_FILE, plan.DEV_FILE, plan.PID_FILE, plan.LOG_FILE]).toEqual([files.CONFIG_FILE, files.DEV_FILE, files.PID_FILE, files.LOG_FILE]);
  for (const config of [{}, { port: 5000 }, { host: '0.0.0.0' }, { host: '::' }, { host: '192.168.1.5', port: 4400 }]) expect(plan.probeAddress(config)).toEqual(probeAddress(config));
});
