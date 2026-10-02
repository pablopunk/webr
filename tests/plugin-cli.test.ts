import { afterEach, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { realRun } from '../server/command';
import { enterPluginDevMode } from '../server/plugin/dev';
import { installPlugin, pluginStatus, restartPluginWebr, uninstallWebrPlugin, type PluginDeps } from '../server/plugin';
import { isPortOpen } from '../server/plugin/probe';
import { PLUGIN_ID, PLUGIN_SOURCE } from '../server/plugin/herdr';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fakeHerdr(installed: 'none' | 'github' | 'local' = 'none') {
  const root = mkdtempSync(join(tmpdir(), 'webr-herdr-')); roots.push(root);
  const pluginRoot = join(root, 'plugin-root');
  mkdirSync(pluginRoot); mkdirSync(join(root, 'config')); mkdirSync(join(root, 'state'));
  writeFileSync(join(pluginRoot, 'launch.mjs'), "console.log('launched with ' + process.env.HERDR_PLUGIN_CONFIG_DIR);\n");
  const calls = join(root, 'calls.txt');
  const registry = join(root, 'registry');
  if (installed !== 'none') writeFileSync(registry, installed);
  const script = `#!/bin/sh
echo "$@" >> "${calls}"
case "$2" in
  list) if [ -f "${registry}" ]; then echo "{\\"result\\":{\\"plugins\\":[{\\"plugin_id\\":\\"${PLUGIN_ID}\\",\\"plugin_root\\":\\"${pluginRoot}\\",\\"source\\":{\\"kind\\":\\"$(cat "${registry}")\\"}}]}}"; else echo '{"result":{"plugins":[]}}'; fi ;;
  config-dir) echo "${join(root, 'config')}" ;;
  install) echo github > "${registry}" ;;
  link) echo local > "${registry}" ;;
  uninstall|unlink) rm -f "${registry}" ;;
esac
`;
  mkdirSync(join(root, 'bin'));
  writeFileSync(join(root, 'bin', 'herdr'), script); chmodSync(join(root, 'bin', 'herdr'), 0o755);
  const run: PluginDeps['run'] = (command, args, env) => realRun(command === 'herdr' ? join(root, 'bin', 'herdr') : command, args, env);
  const deps = (overrides: Partial<PluginDeps> = {}): PluginDeps => ({ run, stateDir: join(root, 'state'), ...overrides });
  return { root, deps, run, config: join(root, 'config'), state: join(root, 'state'), calls: () => readFileSync(calls, 'utf8').trim().split('\n'), registry };
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

it('restarts the plugin by stopping the running Webr and launching again', async () => {
  const herdr = fakeHerdr('github');
  const webr = await startFakeWebr(herdr);
  expect((await restartPluginWebr(herdr.deps()))?.join('\n')).toContain(`launched with ${herdr.config}`);
  await webr.exited;
});

it('leaves a Webr the plugin did not start alone and says how to proceed', async () => {
  const herdr = fakeHerdr('github');
  const webr = await startFakeWebr(herdr);
  rmSync(join(herdr.state, 'webr.pid'));
  expect((await restartPluginWebr(herdr.deps()))?.join('\n')).toContain('the plugin did not start it');
  expect(webr.child.exitCode).toBeNull();
  webr.child.kill();
});

it('has nothing to restart without herdr or the plugin', async () => {
  expect(await restartPluginWebr(fakeHerdr().deps())).toBeUndefined();
  expect(await restartPluginWebr(fakeHerdr('github').deps({ run: () => ({ ok: false, output: '' }) }))).toBeUndefined();
});

it('reports status', async () => {
  const herdr = fakeHerdr('github');
  writeFileSync(join(herdr.config, 'config.json'), JSON.stringify({ port: 1 }));
  const text = (await pluginStatus(herdr.deps())).join('\n');
  expect(text).toContain('Installed (from GitHub)');
  expect(text).toContain('not running on port 1');
  expect((await pluginStatus(fakeHerdr().deps()))[0]).toContain('not installed');
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
  expect(JSON.parse(readFileSync(join(herdr.state, 'dev.json'), 'utf8'))).toEqual({ checkout: '/checkout' });
  expect(readFileSync(herdr.registry, 'utf8').trim()).toBe('local');
  restore();
  expect(existsSync(join(herdr.state, 'dev.json'))).toBe(false);
  expect(readFileSync(herdr.registry, 'utf8').trim()).toBe('github');
  expect(herdr.calls().slice(-2)).toEqual(['plugin link /checkout/plugin', `plugin install ${PLUGIN_SOURCE} --yes`]);
});
