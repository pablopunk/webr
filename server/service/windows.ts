import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ServicePlatform, ServiceSpec } from './types';

export const taskName = 'Webr';
export const launcherPath = (spec: ServiceSpec) => join(dirname(spec.logPath), 'webr-service.ps1');

const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;

export function launcher(spec: ServiceSpec) {
  const environment = Object.entries(spec.env).map(([key, value]) => `$env:${key} = ${literal(value)}`);
  const command = ['&', literal(spec.nodePath), literal(spec.entry), 'start', ...spec.args.map(literal), '*>>', literal(spec.logPath)].join(' ');
  return [...environment, command, ''].join('\r\n');
}

export const windows: ServicePlatform = {
  name: 'Task Scheduler',
  install(spec, run) {
    const script = launcherPath(spec);
    mkdirSync(dirname(script), { recursive: true });
    writeFileSync(script, launcher(spec));
    const action = `powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${script}"`;
    const created = run('schtasks', ['/Create', '/TN', taskName, '/SC', 'ONLOGON', '/RL', 'LIMITED', '/F', '/TR', action]);
    if (!created.ok) throw new Error(`Task Scheduler refused the task. Try again from an elevated terminal. ${created.output.trim()}`);
    run('schtasks', ['/Run', '/TN', taskName]);
    return [`Installed the "${taskName}" scheduled task`, 'Webr starts at login and runs in the background.'];
  },
  uninstall(spec, run) {
    run('schtasks', ['/End', '/TN', taskName]);
    const removed = run('schtasks', ['/Delete', '/TN', taskName, '/F']);
    rmSync(launcherPath(spec), { force: true });
    return [removed.ok ? `Removed the "${taskName}" scheduled task` : 'The service was not installed.'];
  },
  status(spec, run) {
    const query = run('schtasks', ['/Query', '/TN', taskName, '/FO', 'LIST']);
    return { installed: query.ok && existsSync(launcherPath(spec)), running: query.ok && /Status:\s+Running/i.test(query.output) };
  },
};
