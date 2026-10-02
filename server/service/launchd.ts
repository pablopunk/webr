import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ServicePlatform, ServiceSpec } from './types';

export const launchdLabel = 'com.webr.server';
export const plistPath = (userHome: string) => join(userHome, 'Library', 'LaunchAgents', `${launchdLabel}.plist`);

const xml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const strings = (values: string[]) => values.map((value) => `    <string>${xml(value)}</string>`).join('\n');
const entries = (env: Record<string, string>) => Object.entries(env).map(([key, value]) => `    <key>${xml(key)}</key>\n    <string>${xml(value)}</string>`).join('\n');

export function plist(spec: ServiceSpec) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${launchdLabel}</string>
  <key>ProgramArguments</key>
  <array>
${strings([spec.nodePath, spec.entry, 'start', ...spec.args])}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${entries(spec.env)}
  </dict>
  <key>WorkingDirectory</key>
  <string>${xml(spec.userHome)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${xml(spec.logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(spec.logPath)}</string>
</dict>
</plist>
`;
}

const domain = () => `gui/${process.getuid?.() ?? 501}`;
const target = () => `${domain()}/${launchdLabel}`;

export const launchd: ServicePlatform = {
  name: 'launchd',
  install(spec, run) {
    const path = plistPath(spec.userHome);
    mkdirSync(dirname(path), { recursive: true });
    mkdirSync(dirname(spec.logPath), { recursive: true });
    writeFileSync(path, plist(spec), { mode: 0o644 });
    run('launchctl', ['bootout', target()]);
    const loaded = run('launchctl', ['bootstrap', domain(), path]);
    if (!loaded.ok) throw new Error(`launchctl could not load the service: ${loaded.output.trim()}`);
    return [`Installed ${path}`, 'Webr starts at login and restarts if it stops.'];
  },
  uninstall(spec, run) {
    const path = plistPath(spec.userHome);
    run('launchctl', ['bootout', target()]);
    const existed = existsSync(path);
    rmSync(path, { force: true });
    return [existed ? `Removed ${path}` : 'The service was not installed.'];
  },
  status(spec, run) {
    const installed = existsSync(plistPath(spec.userHome));
    return { installed, running: installed && /state = running/.test(run('launchctl', ['print', target()]).output) };
  },
};
