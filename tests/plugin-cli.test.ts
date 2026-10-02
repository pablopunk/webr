import { afterEach, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { realRun } from '../server/service';
import { enterPluginDevMode } from '../server/plugin/dev';
import { installPlugin, pluginStatus, uninstallWebrPlugin, type PluginDeps } from '../server/plugin';
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
  const deps = (overrides: Partial<PluginDeps> = {}): PluginDeps => ({ run, serviceInstalled: () => false, confirm: async () => false, stateDir: join(root, 'state'), ...overrides });
  return { root, deps, run, config: join(root, 'config'), state: join(root, 'state'), calls: () => readFileSync(calls, 'utf8').trim().split('\n'), registry };
}

it('installs from GitHub, writes the settings and starts Webr now', async () => {
  const herdr = fakeHerdr();
  const lines = await installPlugin({ port: 4400, host: '0.0.0.0' }, herdr.deps());
  expect(JSON.parse(readFileSync(join(herdr.config, 'config.json'), 'utf8'))).toEqual({ port: 4400, host: '0.0.0.0' });
  expect(herdr.calls()).toContain(`plugin install ${PLUGIN_SOURCE} --yes`);
  expect(lines.join('\n')).toContain(`launched with ${herdr.config}`);
});

it('warns about the background service and keeps it unless the user agrees to remove it', async () => {
  const herdr = fakeHerdr();
  const lines = await installPlugin({}, herdr.deps({ serviceInstalled: () => true }));
  expect(lines.join('\n')).toContain('Two supervisors');
  expect(lines.join('\n')).toContain('webr service uninstall');
});

it('refuses to install without herdr', async () => {
  const herdr = fakeHerdr();
  await expect(installPlugin({}, herdr.deps({ run: () => ({ ok: false, output: '' }) }))).rejects.toThrow('Herdr is not installed');
});

it('uninstalls a GitHub plugin and unlinks a linked one', () => {
  const github = fakeHerdr('github');
  uninstallWebrPlugin(github.deps());
  expect(github.calls()).toContain(`plugin uninstall ${PLUGIN_ID}`);
  const local = fakeHerdr('local');
  uninstallWebrPlugin(local.deps());
  expect(local.calls()).toContain(`plugin unlink ${PLUGIN_ID}`);
  expect(uninstallWebrPlugin(fakeHerdr().deps())).toEqual(['The Webr plugin is not installed.']);
});

it('reports status and the double-supervisor warning', async () => {
  const herdr = fakeHerdr('github');
  writeFileSync(join(herdr.config, 'config.json'), JSON.stringify({ port: 1 }));
  const text = (await pluginStatus(herdr.deps({ serviceInstalled: () => true }))).join('\n');
  expect(text).toContain('Installed (from GitHub)');
  expect(text).toContain('not running on port 1');
  expect(text).toContain('background service');
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
