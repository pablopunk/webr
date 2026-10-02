import { afterEach, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchd, launchdLabel, plist, plistPath } from '../server/service/launchd';
import { systemd, unit, unitPath } from '../server/service/systemd';
import { launcher, windows } from '../server/service/windows';
import { platformFor, runServiceAction, serviceSpec } from '../server/service';
import { stableEntryPath } from '../server/service/entry';
import type { RunCommand, ServicePlatform, ServiceSpec } from '../server/service/types';
import { publicUrls } from '../src/server/public-urls';

const homes: string[] = [];
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });
const spec = (overrides: Partial<ServiceSpec> = {}): ServiceSpec => {
  const userHome = mkdtempSync(join(tmpdir(), 'webr-service-')); homes.push(userHome);
  return { nodePath: '/opt/node/bin/node', entry: '/opt/webr/bin/webr.mjs', args: ['--port', '4321', '--host', '0.0.0.0'], env: { PATH: '/opt/herdr/bin:/usr/bin', HOME: userHome }, userHome, logPath: join(userHome, '.webr', 'logs', 'webr.log'), ...overrides };
};
const recorder = (failing: string[] = []) => {
  const calls: string[] = [];
  const run: RunCommand = (command, args) => { calls.push([command, ...args].join(' ')); return { ok: !failing.includes(command + ' ' + args[0]), output: '' }; };
  return { calls, run };
};

it('describes a launchd agent that starts at login and restarts', () => {
  const text = plist(spec({ env: { PATH: '/a&b:/usr/bin' } }));
  expect(text).toContain(`<string>${launchdLabel}</string>`);
  expect(text).toMatch(/<string>\/opt\/node\/bin\/node<\/string>\s*<string>\/opt\/webr\/bin\/webr.mjs<\/string>\s*<string>start<\/string>\s*<string>--port<\/string>/);
  expect(text).toContain('<string>/a&amp;b:/usr/bin</string>');
  expect(text).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
  expect(text).toMatch(/<key>KeepAlive<\/key>\s*<true\/>/);
  expect(text).not.toContain('StandardOutPath');
  expect(text).not.toContain('StandardErrorPath');
});

it('installs and removes the launchd agent through launchctl', () => {
  const value = spec(); const { calls, run } = recorder();
  launchd.install(value, run);
  expect(existsSync(plistPath(value.userHome))).toBe(true);
  expect(calls.map((call) => call.split(' ').slice(0, 2).join(' '))).toEqual(['launchctl bootout', 'launchctl bootstrap']);
  expect(launchd.status(value, () => ({ ok: true, output: 'state = running' }))).toEqual({ installed: true, running: true });
  launchd.uninstall(value, run);
  expect(existsSync(plistPath(value.userHome))).toBe(false);
  expect(launchd.status(value, run)).toEqual({ installed: false, running: false });
});

it('reports a launchd load failure', () => {
  expect(() => launchd.install(spec(), recorder(['launchctl bootstrap']).run)).toThrow('launchctl could not load the service');
});

it('quotes systemd arguments and escapes specifiers', () => {
  const text = unit(spec({ args: ['--origin', 'https://a.example/$x%y'], env: { PATH: '/usr/bin' } }));
  expect(text).toContain('ExecStart="/opt/node/bin/node" "/opt/webr/bin/webr.mjs" "start" "--origin" "https://a.example/$$x%%y"');
  expect(text).toContain('Environment="PATH=/usr/bin"');
  expect(text).toMatch(/Restart=always/);
  expect(text).not.toMatch(/Standard(Output|Error)=append/);
  expect(text).toMatch(/WantedBy=default.target/);
});

it('enables the systemd user unit, falling back when lingering is refused', () => {
  const value = spec(); const { calls, run } = recorder(['loginctl enable-linger']);
  const messages = systemd.install(value, run);
  expect(existsSync(unitPath(value.userHome))).toBe(true);
  expect(calls).toContain('systemctl --user enable --now webr.service');
  expect(messages.join('\n')).toContain('enable-linger');
  systemd.uninstall(value, run);
  expect(existsSync(unitPath(value.userHome))).toBe(false);
});

it('writes a hidden Task Scheduler launcher that leaves logging to the app', () => {
  const value = spec({ env: { PATH: "C:\\it's" } });
  expect(launcher(value)).toContain("$env:PATH = 'C:\\it''s'");
  expect(launcher(value)).toContain("& '/opt/node/bin/node' '/opt/webr/bin/webr.mjs' start '--port' '4321'");
  expect(launcher(value)).not.toContain('>>');
  const { calls, run } = recorder();
  windows.install(value, run);
  expect(calls[0]).toMatch(/^schtasks \/Create \/TN Webr \/SC ONLOGON .* -WindowStyle Hidden .*webr-service.ps1"$/);
  expect(calls[1]).toBe('schtasks /Run /TN Webr');
});

it('picks the service manager from the platform and rejects the rest', () => {
  expect([platformFor('darwin').name, platformFor('linux').name, platformFor('win32').name]).toEqual(['launchd', 'systemd', 'Task Scheduler']);
  expect(() => platformFor('freebsd')).toThrow('not supported');
});

it('keeps the environment Herdr needs and the server flags in the service spec', () => {
  const value = serviceSpec(['--port', '5000'], { PATH: '/p', HERDR_CONFIG_PATH: '/h/config.toml', SECRET: 'x', HOME: '/home/me' });
  expect(value.args).toEqual(['--port', '5000']);
  expect(value.env).toEqual({ PATH: '/p', HERDR_CONFIG_PATH: '/h/config.toml', HOME: '/home/me', WEBR_LOG_FILE: value.logPath });
  expect(readFileSync(value.entry, 'utf8')).toContain('#!/usr/bin/env node');
});

it('tells every service manager where the app writes its own rotating log', () => {
  const value = serviceSpec([], { HOME: '/home/me', WEBR_HOME: '/data/webr' });
  expect(value.env.WEBR_LOG_FILE).toBe(join('/data/webr', 'logs', 'webr.log'));
  expect(plist(value)).toContain(`<key>WEBR_LOG_FILE</key>\n    <string>${value.logPath}</string>`);
  expect(unit(value)).toContain(`Environment="WEBR_LOG_FILE=${value.logPath}"`);
  expect(launcher(value)).toContain(`$env:WEBR_LOG_FILE = '${value.logPath}'`);
});

it('restarts the service through each service manager', () => {
  const value = spec();
  const restart = (platform: ServicePlatform) => { const { calls, run } = recorder(); platform.restart(value, run); return calls; };
  expect(restart(launchd)[0]).toMatch(/^launchctl kickstart -k gui\/\d+\/com\.webr\.server$/);
  expect(restart(systemd)).toEqual(['systemctl --user restart webr.service']);
  expect(restart(windows)).toEqual(['schtasks /End /TN Webr', 'schtasks /Run /TN Webr']);
  expect(() => launchd.restart(value, recorder(['launchctl kickstart']).run)).toThrow('could not restart');
  expect(() => systemd.restart(value, recorder(['systemctl --user']).run)).toThrow('could not restart');
  expect(() => windows.restart(value, recorder(['schtasks /Run']).run)).toThrow('could not restart');
});

it('points pnpm installs at the path that survives updates', () => {
  expect(stableEntryPath('/h/.local/share/pnpm/global/5/node_modules/.pnpm/@pablopunk+webr@0.2.0/node_modules/@pablopunk/webr/bin/webr.mjs')).toBe('/h/.local/share/pnpm/global/5/node_modules/@pablopunk/webr/bin/webr.mjs');
  expect(stableEntryPath('/usr/lib/node_modules/webr/bin/webr.mjs')).toBe('/usr/lib/node_modules/webr/bin/webr.mjs');
});

it('summarises the service status for the user', () => {
  const value = spec(); const { run } = recorder();
  expect(runServiceAction('status', [], run, launchd, value)).toEqual(['Not installed.']);
  expect(runServiceAction('install', [], run, launchd, value).join('\n')).toContain(value.logPath);
});

it('lists the addresses other devices can use', () => {
  const interfaces = { en0: [{ address: '192.168.1.5', family: 'IPv4', internal: false }, { address: 'fe80::1', family: 'IPv6', internal: false }], lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }], bridge100: [{ address: '192.168.139.3', family: 'IPv4', internal: false }] } as never;
  expect(publicUrls('http://localhost:4321', '127.0.0.1', 4321, interfaces)).toEqual([]);
  expect(publicUrls('http://localhost:4321', '0.0.0.0', 4321, interfaces)).toEqual(['http://192.168.1.5:4321']);
  expect(publicUrls('https://mac.ts.net', '127.0.0.1', 4321, interfaces)).toEqual(['https://mac.ts.net']);
  expect(publicUrls('https://mac.ts.net', '0.0.0.0', 4321, interfaces)).toEqual(['https://mac.ts.net', 'https://192.168.1.5:4321']);
  expect(publicUrls('http://localhost:4321', '0.0.0.0', 4321, interfaces, 'mac.tail1.ts.net')).toEqual(['http://mac.tail1.ts.net:4321', 'http://192.168.1.5:4321']);
  expect(publicUrls('http://localhost:4321', '127.0.0.1', 4321, interfaces, 'mac.tail1.ts.net')).toEqual([]);
});
