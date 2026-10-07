import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isNewerVersion } from '../server/update/versions';
import { detectPackageManager, globalInstallCommand } from '../server/update/package-manager';
import { fetchLatestVersion, isCacheFresh, readCachedLatest, writeCachedLatest } from '../server/update/latest';
import { updateHint } from '../server/update/hint';
import { UpdateService, updateCommand } from '../server/update/service';
import { runUpdate, type UpdateEnvironment } from '../server/update';
import { packageInfo } from '../server/package-info';
import { checkHerdr, describeHerdrProblem } from '../server/herdr-check';
import type { TargetProfile } from '../src/server/transport/registry';

const homes: string[] = [];
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });
const env = (extra: NodeJS.ProcessEnv = {}) => { const home = mkdtempSync(join(tmpdir(), 'webr-update-')); homes.push(home); return { WEBR_HOME: home, ...extra }; };
const { version } = packageInfo();
const newer = '999.0.0';

it('compares versions numerically and ranks releases above prereleases', () => {
  expect([isNewerVersion('0.10.0', '0.9.9'), isNewerVersion('1.0.0', '1.0.0'), isNewerVersion('0.9.0', '0.10.0'), isNewerVersion('1.0.0', '1.0.0-beta.1'), isNewerVersion('1.0.1-beta.1', '1.0.0'), isNewerVersion('junk', '1.0.0')]).toEqual([true, false, false, true, true, false]);
});

it('tells npm, pnpm and bun installs apart and refuses source checkouts', () => {
  expect(detectPackageManager('/usr/local/lib/node_modules/@pablopunk/webr/package.json')).toBe('npm');
  expect(detectPackageManager('/h/.local/share/pnpm/global/5/node_modules/.pnpm/x@1/node_modules/x/package.json')).toBe('pnpm');
  expect(detectPackageManager('C:\\Users\\me\\AppData\\Local\\pnpm\\global\\5\\node_modules\\x\\package.json')).toBe('pnpm');
  expect(detectPackageManager('/h/.bun/install/global/node_modules/x/package.json')).toBe('bun');
  expect(detectPackageManager('/h/code/webr/package.json')).toBeUndefined();
});

it('installs the exact new version globally with the matching package manager', () => {
  expect(globalInstallCommand('npm', '@pablopunk/webr', '1.2.3')).toEqual({ command: 'npm', args: ['install', '-g', '@pablopunk/webr@1.2.3'] });
  expect(globalInstallCommand('pnpm', 'webr', '1.2.3')).toEqual({ command: 'pnpm', args: ['add', '-g', 'webr@1.2.3'] });
  expect(globalInstallCommand('bun', 'webr', '1.2.3')).toEqual({ command: 'bun', args: ['add', '-g', '--no-cache', 'webr@1.2.3'] });
});

it('reads the latest version from the registry, encoding scoped names', async () => {
  const request = vi.fn(async (..._: unknown[]) => new Response(JSON.stringify({ version: '1.2.3' })));
  expect(await fetchLatestVersion('@pablopunk/webr', request as never)).toBe('1.2.3');
  expect(request.mock.calls[0][0]).toBe('https://registry.npmjs.org/@pablopunk%2Fwebr/latest');
  await expect(fetchLatestVersion('webr', (async () => new Response('', { status: 404 })) as never)).rejects.toThrow('404');
  await expect(fetchLatestVersion('webr', (async () => new Response('{}')) as never)).rejects.toThrow('no version');
});

it('trusts a cached answer for 24 hours', () => {
  const where = env();
  expect(readCachedLatest(where)).toBeUndefined();
  writeCachedLatest('1.0.0', where, 1_000);
  const cached = readCachedLatest(where);
  expect([isCacheFresh(cached, 1_000 + 24 * 3600_000 - 1), isCacheFresh(cached, 1_000 + 24 * 3600_000), isCacheFresh(undefined)]).toEqual([true, false, false]);
});

it('hints about a newer cached version without touching the network', () => {
  const where = env(); const refresh = vi.fn();
  writeCachedLatest(newer, where);
  expect(updateHint(where, refresh)).toContain(`${newer}`);
  expect(updateHint(where, refresh)).toContain('webr update');
  expect(refresh).not.toHaveBeenCalled();
});

it('stays quiet when the cached version is not newer', () => {
  const where = env();
  writeCachedLatest(version, where);
  expect(updateHint(where, vi.fn())).toBeUndefined();
});

it('refreshes a stale or missing cache in the background and answers immediately', () => {
  const missing = vi.fn();
  expect(updateHint(env(), missing)).toBeUndefined();
  expect(missing).toHaveBeenCalledOnce();
  const where = env(); const stale = vi.fn();
  writeCachedLatest(newer, where, 0);
  expect(updateHint(where, stale)).toContain(newer);
  expect(stale).toHaveBeenCalledOnce();
});

it('does nothing when the update check is switched off', () => {
  const where = env({ WEBR_NO_UPDATE_CHECK: '1' }); const refresh = vi.fn();
  writeCachedLatest(newer, where);
  expect(updateHint(where, refresh)).toBeUndefined();
  expect(refresh).not.toHaveBeenCalled();
});

const environment = (overrides: Partial<UpdateEnvironment> = {}): UpdateEnvironment => ({
  installPath: () => '/usr/local/lib/node_modules/webr/package.json',
  latestVersion: async () => newer,
  install: () => true,
  installedVersion: () => newer,
  restartPlugin: async () => ['Restarted the plugin.'],
  ...overrides,
});

it('installs a newer version and restarts the plugin', async () => {
  process.env.WEBR_HOME = env().WEBR_HOME;
  const install = vi.fn(() => true);
  const lines = await runUpdate(environment({ install }));
  expect(install).toHaveBeenCalledWith({ command: 'npm', args: ['install', '-g', `${packageInfo().name}@${newer}`] });
  expect(lines).toEqual([`Updated Webr ${version} → ${newer}.`, 'Restarted the plugin.']);
});

it('says to restart Herdr when the plugin is not installed', async () => {
  process.env.WEBR_HOME = env().WEBR_HOME;
  expect((await runUpdate(environment({ restartPlugin: async () => undefined }))).at(-1)).toContain('Restart Herdr');
});

it('skips the install but still restarts the plugin when already up to date', async () => {
  process.env.WEBR_HOME = env().WEBR_HOME;
  const install = vi.fn(() => true); const restartPlugin = vi.fn(async () => ['Restarted.']);
  expect(await runUpdate(environment({ latestVersion: async () => version, install, restartPlugin }))).toEqual([`Webr ${version} is the latest version.`, 'Restarted.']);
  expect(install).not.toHaveBeenCalled(); expect(restartPlugin).toHaveBeenCalledOnce();
});

it('fails clearly when the install fails or the copy is not a global install', async () => {
  process.env.WEBR_HOME = env().WEBR_HOME;
  await expect(runUpdate(environment({ install: () => false }))).rejects.toThrow('npm could not install');
  await expect(runUpdate(environment({ installPath: () => '/code/webr/package.json' }))).rejects.toThrow('not installed globally');
  await expect(runUpdate(environment({ installedVersion: () => version }))).rejects.toThrow(`still ${version} instead of ${newer}`);
  await expect(runUpdate(environment({ installedVersion: () => undefined }))).rejects.toThrow('still unreadable');
});

const local = { id: 'local', name: 'Local', session: 'default', enabled: true, transport: 'local', locations: [] } as TargetProfile;

it('accepts a reachable Herdr session', async () => {
  expect(await checkHerdr(async () => local, async () => true)).toEqual({ ok: true });
});

it('notes that Herdr is not running yet instead of failing', async () => {
  const status = await checkHerdr(async () => local, async () => false);
  expect(status).toMatchObject({ ok: true, note: expect.stringContaining('not running yet') });
});

it('turns discovery failures into advice', async () => {
  const failing = (error: unknown) => checkHerdr(async () => { throw error; });
  expect(await failing(Object.assign(new Error('spawn herdr ENOENT'), { code: 'ENOENT' }))).toMatchObject({ ok: false, problem: expect.stringContaining('PATH') });
  expect(await failing(new Error('multiple_herdr_sessions: start the app'))).toMatchObject({ problem: expect.stringContaining('HERDR_SESSION') });
  expect(await failing(new Error('herdr_session_unreachable'))).toMatchObject({ problem: expect.stringContaining('start it again') });
  expect(describeHerdrProblem(new Error('weird'))).toContain('weird');
});

it('reports an unresponsive session when the ping fails for another reason', async () => {
  const status = await checkHerdr(async () => local, async () => { throw new Error('rpc_timeout'); });
  expect(status).toMatchObject({ ok: false, problem: expect.stringContaining('does not answer') });
});

const waitingService = (deps: ConstructorParameters<typeof UpdateService>[0] = {}) => {
  const exits: ((code: number | null) => void)[] = [];
  const home = deps.env ?? env();
  writeCachedLatest(newer, home);
  const service = new UpdateService({ env: home, command: { command: 'webr', args: ['update'] }, run: (_command, onExit) => { exits.push(onExit); }, tail: () => 'boom', restartGraceMs: 5, ...deps });
  return { service, exits };
};

it('offers an update only when the registry has a newer version and an update command exists', () => {
  const { service } = waitingService();
  expect(service.status()).toMatchObject({ current: version, latest: newer, available: true, state: 'idle' });
  expect(waitingService({ command: undefined }).service.status().available).toBe(false);
  const disabled = env({ WEBR_NO_UPDATE_CHECK: '1' });
  writeCachedLatest(newer, disabled);
  expect(new UpdateService({ env: disabled, command: { command: 'webr', args: [] } }).status().available).toBe(false);
});

it('checks the registry on demand and reports the fresh status', async () => {
  const home = env();
  const service = new UpdateService({ env: home, command: { command: 'webr', args: ['update'] }, fetchLatest: async () => newer });
  expect(service.status().available).toBe(false);
  expect(await service.check()).toMatchObject({ latest: newer, available: true });
});

it('starts one update at a time and reports its output when it fails', () => {
  const { service, exits } = waitingService();
  expect(service.start().state).toBe('updating');
  service.start();
  expect(exits).toHaveLength(1);
  exits[0]!(1);
  expect(service.status()).toMatchObject({ state: 'failed', error: 'The update failed.\nboom' });
});

it('reports a failure when the update succeeds but the server never restarts', async () => {
  const { service, exits } = waitingService();
  service.start();
  exits[0]!(0);
  expect(service.status().state).toBe('updating');
  await expect.poll(() => service.status().state).toBe('failed');
});

it('refreshes the cached latest version from the registry', async () => {
  const { service } = waitingService({ fetchLatest: async () => '1000.0.0' });
  await service.refresh();
  expect(service.status().latest).toBe('1000.0.0');
});

it('runs the installed webr for global installs and npx for npx runs', () => {
  expect(updateCommand('/usr/local/lib/node_modules/@pablopunk/webr/package.json', '@pablopunk/webr')?.args.at(-1)).toBe('update');
  expect(updateCommand('/h/.npm/_npx/abc/node_modules/@pablopunk/webr/package.json', '@pablopunk/webr')).toEqual({ command: 'npx', args: ['--yes', '@pablopunk/webr@latest', 'update'] });
  expect(updateCommand('/h/code/webr/package.json', '@pablopunk/webr')).toBeUndefined();
});

it('restarts through the restart command even when no update is available', () => {
  const ran: string[][] = [];
  const service = new UpdateService({ env: env(), command: undefined, restartCommand: { command: 'webr', args: ['restart'] }, run: ({ args }) => { ran.push(args); } });
  expect(service.status().available).toBe(false);
  service.restart();
  expect(ran).toEqual([['restart']]);
});

it('builds the restart command from the installed webr', () => {
  expect(updateCommand('/usr/local/lib/node_modules/@pablopunk/webr/package.json', '@pablopunk/webr', 'restart')?.args.at(-1)).toBe('restart');
});

it('reports a failed manual check instead of keeping the stale version', async () => {
  const { service } = waitingService({ fetchLatest: async () => { throw new Error('offline'); } });
  await expect(service.check()).rejects.toThrow('offline');
  await expect(service.refresh()).resolves.toBeUndefined();
});
