import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ServicePlatform, ServiceSpec } from './types';

export const unitName = 'webr.service';
export const unitPath = (userHome: string) => join(userHome, '.config', 'systemd', 'user', unitName);

const quote = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%')}"`;
const quoteExec = (value: string) => quote(value).replace(/\$/g, '$$$$');

export function unit(spec: ServiceSpec) {
  return `[Unit]
Description=Webr
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=${[spec.nodePath, spec.entry, 'start', ...spec.args].map(quoteExec).join(' ')}
${Object.entries(spec.env).map(([key, value]) => `Environment=${quote(`${key}=${value}`)}`).join('\n')}
WorkingDirectory=${spec.userHome}
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`;
}

export const systemd: ServicePlatform = {
  name: 'systemd',
  install(spec, run) {
    const path = unitPath(spec.userHome);
    mkdirSync(dirname(path), { recursive: true });
    mkdirSync(dirname(spec.logPath), { recursive: true });
    writeFileSync(path, unit(spec), { mode: 0o644 });
    run('systemctl', ['--user', 'daemon-reload']);
    const enabled = run('systemctl', ['--user', 'enable', '--now', unitName]);
    if (!enabled.ok) throw new Error(`systemctl could not start the service: ${enabled.output.trim()}`);
    const linger = run('loginctl', ['enable-linger', process.env.USER ?? '']);
    return [`Installed ${path}`, linger.ok ? 'Webr starts at boot and restarts if it stops.' : `Webr starts at login. To start it at boot, run: sudo loginctl enable-linger ${process.env.USER ?? '$USER'}`];
  },
  restart(_spec, run) {
    const restarted = run('systemctl', ['--user', 'restart', unitName]);
    if (!restarted.ok) throw new Error(`systemctl could not restart the service: ${restarted.output.trim()}`);
    return ['Restarted the service.'];
  },
  uninstall(spec, run) {
    const path = unitPath(spec.userHome);
    run('systemctl', ['--user', 'disable', '--now', unitName]);
    const existed = existsSync(path);
    rmSync(path, { force: true });
    run('systemctl', ['--user', 'daemon-reload']);
    return [existed ? `Removed ${path}` : 'The service was not installed.'];
  },
  status(spec, run) {
    const installed = existsSync(unitPath(spec.userHome));
    return { installed, running: installed && run('systemctl', ['--user', 'is-active', unitName]).output.trim() === 'active' };
  },
};
