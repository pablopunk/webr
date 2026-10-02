import { expect, it, vi } from 'vitest';
import { discoverLocalSession, localSessionBootstrap, type LocalSessionDependencies } from '../src/server/transport/local-session';
import { profileSchema } from '../src/server/transport/registry';
import { MetadataDatabase } from '../src/server/storage/database';
import { SocketApi } from '../src/server/protocol/socket';

const session = (name: string, running = true) => ({ name, default: name === 'default', running, socket_path: `/test/${name}/herdr.sock` });
const discovery = (sessions: ReturnType<typeof session>[]) => vi.fn(async () => JSON.stringify({ sessions }));
const missing = () => Object.assign(new Error('socket_unavailable'), { code: 'ENOENT' });
const profile = profileSchema.parse({ id: 'local', name: 'Local', session: 'default', enabled: true, transport: 'local', socket: '/test/herdr.sock', locations: [], automatic: true });
const dependencies = (): LocalSessionDependencies => ({ process: vi.fn(async () => 'herdr 0.9.3'), exists: vi.fn(async () => false), ping: vi.fn(async () => ({ version: '0.9.3', protocol: 22 })), start: vi.fn(async () => {}), sleep: vi.fn(async () => {}) });
it('preserves the socket error code so bootstrap can distinguish absence from a failed live connection', async () => {
  const api = new SocketApi('/private/var/herdr-web-nonexistent-' + process.pid + '.sock');
  try { await expect(api.request('ping')).rejects.toMatchObject({ message: 'socket_unavailable', code: 'ENOENT' }); }
  finally { api.close(); }
});

it('uses the inherited current socket or named session without global session discovery', async () => {
  const process = discovery([]);
  expect(await discoverLocalSession({ HERDR_SOCKET_PATH: '/test/current.sock', HERDR_SESSION: 'work' }, process)).toMatchObject({ session: 'work', socket: '/test/current.sock', automatic: true, locations: [] });
  expect(await discoverLocalSession({ HERDR_SESSION: 'work' }, process)).toMatchObject({ session: 'work' });
  expect(process).not.toHaveBeenCalled();
});
it('reuses the sole running session or the running default rather than creating a second session', async () => {
  expect(await discoverLocalSession({}, discovery([session('default', false), session('work')]))).toMatchObject({ session: 'work', socket: '/test/work/herdr.sock' });
  expect(await discoverLocalSession({}, discovery([session('default'), session('work')]))).toMatchObject({ session: 'default' });
  await expect(discoverLocalSession({}, discovery([session('default', false), session('one'), session('two')]))).rejects.toThrow('multiple_herdr_sessions');
});
it('chooses an absent default only when stopped session sockets are absent, not when they are inaccessible', async () => {
  expect(await discoverLocalSession({}, discovery([session('default', false)]), async () => false)).toMatchObject({ session: 'default' });
  await expect(discoverLocalSession({}, discovery([session('default', false)]), async () => true)).rejects.toThrow('herdr_session_unreachable');
  await expect(discoverLocalSession({}, discovery([session('default', false)]), async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); })).rejects.toThrow('denied');
});
it('attaches a responding session without starting or changing its workspaces', async () => {
  const deps = dependencies(); await localSessionBootstrap(deps)(profile);
  expect(deps.ping).toHaveBeenCalledWith('/test/herdr.sock'); expect(deps.start).not.toHaveBeenCalled();
});
it('starts one missing session for concurrent callers and never stops it', async () => {
  const deps = dependencies(); vi.mocked(deps.ping).mockRejectedValueOnce(missing());
  const bootstrap = localSessionBootstrap(deps);
  await Promise.all([bootstrap(profile), bootstrap(profile), bootstrap(profile)]);
  await bootstrap(profile);
  expect(deps.start).toHaveBeenCalledExactlyOnceWith(profile);
});
it.each(['ECONNREFUSED', 'EACCES', 'ETIMEDOUT', undefined])('does not create a replacement after a %s failure', async (code) => {
  const deps = dependencies(); vi.mocked(deps.ping).mockRejectedValue(Object.assign(new Error('unreachable'), { code }));
  await expect(localSessionBootstrap(deps)(profile)).rejects.toThrow('unreachable'); expect(deps.start).not.toHaveBeenCalled();
});
it('does not start over an existing socket or with an unsupported installed version', async () => {
  const deps = dependencies(); vi.mocked(deps.ping).mockRejectedValue(missing()); vi.mocked(deps.exists).mockResolvedValue(true);
  await expect(localSessionBootstrap(deps)(profile)).rejects.toThrow('herdr_session_unreachable'); expect(deps.start).not.toHaveBeenCalled();
  vi.mocked(deps.exists).mockResolvedValue(false); vi.mocked(deps.process).mockResolvedValue('herdr 0.8.0');
  await expect(localSessionBootstrap(deps)(profile)).rejects.toThrow('unsupported_herdr_version'); expect(deps.start).not.toHaveBeenCalled();
});
it('does not repeat an uncertain server start', async () => {
  const deps = dependencies(); vi.mocked(deps.ping).mockRejectedValue(missing());
  const bootstrap = localSessionBootstrap(deps);
  await expect(bootstrap(profile)).rejects.toThrow('herdr_session_start_unknown');
  await expect(bootstrap(profile)).rejects.toThrow('herdr_session_start_unknown'); expect(deps.start).toHaveBeenCalledTimes(1);
});
