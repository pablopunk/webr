import { afterEach, beforeEach, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { realRun } from '../server/command';
import { enterPluginDevMode, stopProductionWebr } from '../server/plugin/dev';
import { installPlugin, uninstallWebrPlugin, updatePlugin, type PluginDeps } from '../server/plugin';
import { isPortOpen } from '../server/plugin/probe';
import { modeLines, pluginMode } from '../server/plugin/mode';
import { PLUGIN_ID, PLUGIN_SOURCE } from '../server/plugin/herdr';

const roots: string[] = [];
const realHome = process.env.WEBR_HOME;
beforeEach(() => { const home = mkdtempSync(join(tmpdir(), 'webr-home-')); roots.push(home); process.env.WEBR_HOME = home; });
afterEach(() => { if (realHome === undefined) delete process.env.WEBR_HOME; else process.env.WEBR_HOME = realHome; for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fakeHerdr(installed: 'none' | 'github' | 'local' = 'none') {
  const root = mkdtempSync(join(tmpdir(), 'webr-herdr-')); roots.push(root);
  const pluginRoot = join(root, 'plugin-root');
  mkdirSync(pluginRoot); mkdirSync(join(root, 'config')); mkdirSync(join(root, 'state'));
  writeFileSync(join(pluginRoot, 'launch.mjs'), "import { appendFileSync } from 'node:fs';\nappendFileSync(process.env.HERDR_PLUGIN_STATE_DIR + '/launches', 'x');\nconsole.log('launched with ' + process.env.HERDR_PLUGIN_CONFIG_DIR);\n");
  const calls = join(root, 'calls.txt');
  const registry = join(root, 'registry');
  if (installed !== 'none') writeFileSync(registry, installed);
  const script = `#!/bin/sh
echo "$@" >> "${calls}"
case "$2" in
  list) if [ -f "${registry}" ]; then echo "{\\"result\\":{\\"plugins\\":[{\\"plugin_id\\":\\"${PLUGIN_ID}\\",\\"plugin_root\\":\\"${pluginRoot}\\",\\"source\\":{\\"kind\\":\\"$(cat "${registry}")\\"}}]}}"; else echo '{"result":{"plugins":[]}}'; fi ;;
  config-dir) echo "${join(root, 'config')}" ;;
  install) if [ "$(cat "${registry}" 2>/dev/null)" = local ]; then echo "plugin pablopunk.webr is already linked from a local path; uninstall/unlink it before installing from GitHub" >&2; exit 1; fi; echo github > "${registry}" ;;
  link) echo local > "${registry}" ;;
  uninstall|unlink) rm -f "${registry}" ;;
esac
`;
  mkdirSync(join(root, 'bin'));
  writeFileSync(join(root, 'bin', 'herdr'), script); chmodSync(join(root, 'bin', 'herdr'), 0o755);
  const webrCalls = join(root, 'webr-calls');
  writeFileSync(join(root, 'bin', 'webr'), `#!/bin/sh\necho "$@" >> "${webrCalls}"\necho refreshed\n`); chmodSync(join(root, 'bin', 'webr'), 0o755);
  const fakeBinary = (command: string) => command === 'herdr' || command === 'webr' ? join(root, 'bin', command) : command;
  const run: PluginDeps['run'] = (command, args, env) => realRun(fakeBinary(command), args, env);
  const deps = (overrides: Partial<PluginDeps> = {}): PluginDeps => ({ run, stateDir: join(root, 'state'), ...overrides });
  return { root, deps, run, config: join(root, 'config'), state: join(root, 'state'), calls: () => readFileSync(calls, 'utf8').trim().split('\n'), registry, webrCalls: () => existsSync(webrCalls) ? readFileSync(webrCalls, 'utf8').trim().split('\n') : [] };
}

it('installs from GitHub, writes the settings and starts Webr now', async () => {
  const herdr = fakeHerdr();
  const lines = await installPlugin({ port: 4400, host: '0.0.0.0' }, herdr.deps());
  expect(JSON.parse(readFileSync(join(herdr.config, 'config.json'), 'utf8'))).toEqual({ port: 4400, host: '0.0.0.0' });
  expect(herdr.calls()).toContain(`plugin install ${PLUGIN_SOURCE} --yes`);
  expect(lines.join('\n')).toContain(`launched with ${herdr.config}`);
});

it('refuses to install without git because herdr clones plugins with it', async () => {
  const herdr = fakeHerdr();
  const withoutGit: PluginDeps['run'] = (command, args, env) => command === 'git' ? { ok: false, output: '' } : herdr.run(command, args, env);
  await expect(installPlugin({}, herdr.deps({ run: withoutGit }))).rejects.toThrow('Git is not installed');
});

it('refuses to install without herdr', async () => {
  const herdr = fakeHerdr();
  await expect(installPlugin({}, herdr.deps({ run: () => ({ ok: false, output: '' }) }))).rejects.toThrow('Herdr is not installed');
});

it('uninstalls a GitHub plugin and unlinks a linked one', async () => {
  const github = fakeHerdr('github');
  await uninstallWebrPlugin(github.deps());
  expect(existsSync(github.config)).toBe(false);
  expect(existsSync(github.state)).toBe(false);
  expect(github.calls()).toContain(`plugin uninstall ${PLUGIN_ID}`);
  const local = fakeHerdr('local');
  await uninstallWebrPlugin(local.deps());
  expect(local.calls()).toContain(`plugin unlink ${PLUGIN_ID}`);
  expect(await uninstallWebrPlugin(fakeHerdr().deps())).toEqual(['The Webr plugin is not installed.']);
});

const freePort = () => new Promise<number>((done) => {
  const probe = createServer().listen(0, '127.0.0.1', () => { const { port } = probe.address() as { port: number }; probe.close(() => done(port)); });
});

async function startFakeWebr(herdr: ReturnType<typeof fakeHerdr>) {
  const port = await freePort();
  writeFileSync(join(herdr.config, 'config.json'), JSON.stringify({ port }));
  const child = spawn(process.execPath, ['-e', `require('net').createServer().listen(${port}, '127.0.0.1')`], { stdio: 'ignore' });
  writeFileSync(join(herdr.state, 'webr.pid'), String(child.pid));
  for (let attempt = 0; attempt < 50 && !(await isPortOpen({ host: '127.0.0.1', port })); attempt++) await new Promise((done) => setTimeout(done, 50));
  const exited = new Promise<void>((done) => child.once('exit', () => done()));
  return { port, child, exited };
}

it('stops the running Webr when the plugin is uninstalled', async () => {
  const herdr = fakeHerdr('github');
  const webr = await startFakeWebr(herdr);
  expect(await uninstallWebrPlugin(herdr.deps())).toContain('Stopped the running Webr.');
  await webr.exited;
  expect(existsSync(join(herdr.state, 'webr.pid'))).toBe(false);
});

it('updates the plugin by stopping the running Webr and letting the new webr reinstall it', async () => {
  const herdr = fakeHerdr('github');
  const webr = await startFakeWebr(herdr);
  expect(await updatePlugin(herdr.deps())).toEqual(['refreshed']);
  expect(herdr.webrCalls()).toEqual(['install --no-open']);
  await webr.exited;
});

it('leaves a Webr the plugin did not start alone and says how to proceed', async () => {
  const herdr = fakeHerdr('github');
  const webr = await startFakeWebr(herdr);
  rmSync(join(herdr.state, 'webr.pid'));
  expect((await updatePlugin(herdr.deps()))?.join('\n')).toContain('the plugin did not start it');
  expect(webr.child.exitCode).toBeNull();
  webr.child.kill();
});

it('has nothing to restart without herdr or the plugin', async () => {
  expect(await updatePlugin(fakeHerdr().deps())).toBeUndefined();
  expect(await updatePlugin(fakeHerdr('github').deps({ run: () => ({ ok: false, output: '' }) }))).toBeUndefined();
});

it('never adds the plugin in dev mode for someone who did not install it', () => {
  const herdr = fakeHerdr();
  const restore = enterPluginDevMode('/checkout', herdr.run, herdr.state);
  restore();
  expect(herdr.calls().filter((call) => call.startsWith('plugin link') || call.startsWith('plugin install'))).toEqual([]);
  expect(existsSync(join(herdr.state, 'dev.json'))).toBe(false);
});

it('links the checkout in dev mode and restores the GitHub plugin afterwards', () => {
  const herdr = fakeHerdr('github');
  const restore = enterPluginDevMode('/checkout', herdr.run, herdr.state);
  expect(JSON.parse(readFileSync(join(herdr.state, 'dev.json'), 'utf8'))).toEqual({ checkout: '/checkout', pid: process.pid });
  expect(readFileSync(herdr.registry, 'utf8').trim()).toBe('local');
  restore();
  expect(existsSync(join(herdr.state, 'dev.json'))).toBe(false);
  expect(readFileSync(herdr.registry, 'utf8').trim()).toBe('github');
  const mutations = herdr.calls().filter((call) => /^plugin (link|unlink|install)/.test(call));
  expect(mutations).toEqual(['plugin link /checkout/plugin', `plugin unlink ${PLUGIN_ID}`, `plugin install ${PLUGIN_SOURCE} --yes`]);
});

it('stops the production Webr for dev and starts it again when dev stops', async () => {
  const herdr = fakeHerdr('github');
  const webr = await startFakeWebr(herdr);
  expect(await stopProductionWebr(herdr.run, herdr.state)).toBe(true);
  await webr.exited;
  const restore = enterPluginDevMode('/checkout', herdr.run, herdr.state, true);
  expect(existsSync(join(herdr.state, 'dev.json'))).toBe(true);
  restore();
  expect(existsSync(join(herdr.state, 'dev.json'))).toBe(false);
  expect(readFileSync(join(herdr.state, 'launches'), 'utf8')).toBe('x');
});

it('stops a production Webr that is still starting up', async () => {
  const herdr = fakeHerdr('github');
  const port = await freePort();
  writeFileSync(join(herdr.config, 'config.json'), JSON.stringify({ port }));
  const child = spawn(process.execPath, ['-e', `setTimeout(() => require('net').createServer().listen(${port}, '127.0.0.1'), 500)`], { stdio: 'ignore' });
  writeFileSync(join(herdr.state, 'webr.pid'), String(child.pid));
  const exited = new Promise<void>((done) => child.once('exit', () => done()));
  expect(await stopProductionWebr(herdr.run, herdr.state)).toBe(true);
  await exited;
});

it('leaves the production Webr alone when it is not running', async () => {
  const herdr = fakeHerdr('github');
  expect(await stopProductionWebr(herdr.run, herdr.state)).toBe(false);
});

const deadPid = () => spawnSync(process.execPath, ['-e', '']).pid!;
const recordDev = (herdr: ReturnType<typeof fakeHerdr>, pid: number) => writeFileSync(join(herdr.state, 'dev.json'), JSON.stringify({ checkout: '/checkout', pid }));

it('tells production, a live dev run, a stuck link and no plugin apart', () => {
  expect(pluginMode(fakeHerdr().run, fakeHerdr().state)).toEqual({ kind: 'absent' });
  expect(pluginMode(fakeHerdr('github').run, fakeHerdr('github').state)).toEqual({ kind: 'production' });
  const live = fakeHerdr('local'); recordDev(live, process.pid);
  expect(pluginMode(live.run, live.state)).toEqual({ kind: 'dev', checkout: '/checkout' });
  const crashed = fakeHerdr('local'); recordDev(crashed, deadPid());
  expect(pluginMode(crashed.run, crashed.state)).toEqual({ kind: 'stuck', where: '/checkout' });
  const linked = fakeHerdr('local');
  expect(pluginMode(linked.run, linked.state).kind).toBe('stuck');
});

it('shows the mode in status and says how to recover', async () => {
  const live = fakeHerdr('local'); recordDev(live, process.pid);
  expect(modeLines(pluginMode(live.run, live.state)).join('\n')).toContain('Mode: dev, running from /checkout');
  const crashed = fakeHerdr('local'); recordDev(crashed, deadPid());
  expect(modeLines(pluginMode(crashed.run, crashed.state)).join('')).toContain('webr install');
  expect(modeLines(pluginMode(fakeHerdr('github').run, fakeHerdr('github').state)).join('\n')).toContain('Mode: production');
});

it('install puts production back after a crashed dev run, keeping saved settings', async () => {
  const herdr = fakeHerdr('local'); recordDev(herdr, deadPid());
  const port = await freePort();
  writeFileSync(join(herdr.config, 'config.json'), JSON.stringify({ port, origin: 'https://mac.example.ts.net' }));
  const lines = await installPlugin({}, herdr.deps());
  expect(lines[0]).toContain('Installed the Webr plugin');
  expect(readFileSync(herdr.registry, 'utf8').trim()).toBe('github');
  expect(existsSync(join(herdr.state, 'dev.json'))).toBe(false);
  expect(JSON.parse(readFileSync(join(herdr.config, 'config.json'), 'utf8'))).toEqual({ port, origin: 'https://mac.example.ts.net' });
  expect(readFileSync(join(herdr.state, 'launches'), 'utf8')).toBe('x');
});

it('install also repairs a link that has no dev record', async () => {
  const herdr = fakeHerdr('local');
  await installPlugin({}, herdr.deps());
  expect(readFileSync(herdr.registry, 'utf8').trim()).toBe('github');
});

it('install refuses while pnpm dev is running', async () => {
  const live = fakeHerdr('local'); recordDev(live, process.pid);
  await expect(installPlugin({}, live.deps())).rejects.toThrow('"pnpm dev" is running');
  expect(readFileSync(live.registry, 'utf8').trim()).toBe('local');
});

it('saves the launching webr so Herdr can start it without your shell PATH', async () => {
  const herdr = fakeHerdr();
  const launcher = { node: '/opt/node', entry: '/opt/webr/bin/webr.mjs' };
  await installPlugin({ port: 4400 }, herdr.deps({ launcher }));
  expect(JSON.parse(readFileSync(join(herdr.config, 'config.json'), 'utf8'))).toEqual({ port: 4400, launcher });
});
