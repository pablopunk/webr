import { spawn } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { SocketApi } from '../protocol/socket';
import { boundedProcess } from './process';
import { localSocket, profileSchema, type TargetProfile } from './registry';

const sessionName = z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/).refine((name) => !['.', '..'].includes(name));
const sessionsResult = z.object({ sessions: z.array(z.object({ name: sessionName, default: z.boolean(), running: z.boolean(), socket_path: z.string().startsWith('/') })).min(1).max(1000) });
const pathExists = async (path: string) => { try { await lstat(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; } };
const ping = async (socket: string) => { const api = new SocketApi(socket); try { return await api.request('ping'); } finally { api.close(); } };
const start = async (profile: TargetProfile) => {
  const env: NodeJS.ProcessEnv = { ...process.env, HERDR_SOCKET_PATH: localSocket(profile), HERDR_SESSION: profile.session };
  delete env.HERDR_CLIENT_SOCKET_PATH;
  delete env.HERDR_STARTUP_CWD;
  const child = spawn(profile.executable ?? 'herdr', ['server'], { env, detached: true, stdio: 'ignore' });
  await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.unref();
};
export type LocalSessionDependencies = { process: typeof boundedProcess; exists: typeof pathExists; ping: typeof ping; start: typeof start; sleep: (ms: number) => Promise<void> };
const defaults: LocalSessionDependencies = { process: boundedProcess, exists: pathExists, ping, start, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };

export async function discoverLocalSession(env = process.env, runProcess = boundedProcess, exists = pathExists): Promise<TargetProfile> {
  const base = { id: 'local', name: 'Local', session: env.HERDR_SESSION ?? 'default', enabled: true, transport: 'local', locations: [], automatic: true };
  if (env.HERDR_SOCKET_PATH) return profileSchema.parse({ ...base, socket: env.HERDR_SOCKET_PATH });
  if (env.HERDR_SESSION) return profileSchema.parse(base);
  const { sessions } = sessionsResult.parse(JSON.parse(await runProcess('herdr', ['session', 'list', '--json'], env)));
  const running = sessions.filter((session) => session.running);
  const selected = running.find((session) => session.default) ?? (running.length === 1 ? running[0] : undefined);
  if (running.length && !selected) throw new Error('multiple_herdr_sessions: start the app from the desired Herdr session');
  const current = selected ?? sessions.find((session) => session.default);
  if (!current) throw new Error('missing_default_session');
  if (!selected) for (const session of sessions) {
    if (await exists(session.socket_path) || await exists(join(dirname(session.socket_path), 'herdr-client.sock'))) throw new Error('herdr_session_unreachable');
  }
  return profileSchema.parse({ ...base, session: current.name, socket: current.socket_path });
}

export function localSessionBootstrap(dependencies: LocalSessionDependencies = defaults) {
  const pending = new Map<string, Promise<void>>();
  return (profile: TargetProfile): Promise<void> => {
    const socket = localSocket(profile);
    const existing = pending.get(socket);
    if (existing) return existing;
    const promise = (async () => {
      try { await dependencies.ping(socket); return; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (await dependencies.exists(socket) || await dependencies.exists(join(dirname(socket), 'herdr-client.sock'))) throw new Error('herdr_session_unreachable');
      const version = await dependencies.process(profile.executable ?? 'herdr', ['--version']);
      if (version.trim() !== 'herdr 0.9.3') throw new Error('unsupported_herdr_version');
      await dependencies.start(profile);
      for (let attempt = 0; attempt < 100; attempt++) {
        try { await dependencies.ping(socket); return; }
        catch (error) { if (!['ENOENT', 'ECONNREFUSED'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
        await dependencies.sleep(100);
      }
      throw new Error('herdr_session_start_unknown');
    })();
    pending.set(socket, promise);
    return promise;
  };
}

export const ensureLocalSession = localSessionBootstrap();
