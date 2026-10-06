import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { MetadataDatabase } from '../src/server/storage/database';
import { createHost } from '../src/server/host';
import { RuntimeManager } from '../src/server/runtime/manager';
import { FakeTarget, launch, frame } from './fixtures/target';
import { decodeFrame } from '../src/shared/frame';
import { WebSocket } from 'ws';
import { mkdtemp, readFile, rm, stat, utimes, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UploadStore } from '../src/server/uploads';

const cleanups: (() => Promise<unknown> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const origin = 'http://localhost:4321';
async function setup(serverOrigin = origin, ssr?: Parameters<typeof createHost>[2]) {
  const database = new MetadataDatabase(':memory:'); cleanups.push(() => database.close());
  const target = new FakeTarget(); const manager = new RuntimeManager(database, [target]);
  const uploadDirectory = await mkdtemp(join(tmpdir(), 'hw-uploads-')); cleanups.push(() => rm(uploadDirectory, { recursive: true, force: true }));
  const app = await createHost(manager, serverOrigin, ssr, undefined, new UploadStore(join(uploadDirectory, 'images'))); cleanups.push(() => app.close());
  manager.start(); await expect.poll(() => manager.bootstrap().machines[0].connected).toBe(true);
  const headers = { host: new URL(serverOrigin).host, origin: serverOrigin };
  return { database, target, manager, app, headers, uploadDirectory: join(uploadDirectory, 'images') };
}
async function pair(app: Awaited<ReturnType<typeof createHost>>, headers: Record<string, string>) {
  const instance = randomUUID(); const records: unknown[] = [];
  if (!app.server.listening) await app.listen({ host: '127.0.0.1', port: 0 });
  const port = (app.server.address() as { port: number }).port;
  const open = async (kind: string) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/api/ws/${kind}?instance=${instance}`, { headers });
    if (kind === 'metadata') socket.on('message', (data) => records.push(JSON.parse(data.toString())));
    await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    return socket;
  };
  const metadata = await open('metadata'); const terminal = await open('terminal');
  cleanups.push(() => { metadata.close(); terminal.close(); });
  return { metadata, terminal, records };
}
it('opens resources without accounts or cookies and guards Host and Origin', async () => {
  const { app, headers, database } = await setup();
  expect(database.getSetting('allowed_account')).toBeUndefined();
  for (const url of ['/api/runtime', '/api/catalog/machines', '/api/stats']) {
    const response = await app.inject({ url, headers: { host: 'localhost:4321' } });
    expect(response.statusCode).toBe(200); expect(response.headers['set-cookie']).toBeUndefined();
  }
  expect((await app.inject({ method: 'POST', url: '/api/auth/sign-up/email', headers, payload: {} })).statusCode).toBe(404);
  expect((await app.inject({ url: '/api/runtime', headers: { ...headers, host: 'attacker.invalid' } })).statusCode).toBe(403);
  expect((await app.inject({ method: 'POST', url: '/api/threads', headers: { ...headers, origin: 'https://attacker.invalid' }, payload: launch })).statusCode).toBe(403);
  await expect(app.injectWS('/api/ws/metadata?instance=' + randomUUID(), { headers: { host: 'localhost:4321' } })).rejects.toThrow();
  await expect(app.injectWS('/api/ws/metadata?instance=' + randomUUID(), { headers: { ...headers, origin: 'https://attacker.invalid' } })).rejects.toThrow();
});
it.each(['localhost:4321', '127.0.0.1:4321', '[::1]:4321'])('accepts the loopback alias %s for pages, API writes and paired sockets', async (host) => {
  const { app } = await setup('http://127.0.0.1:4321'); const headers = { host, origin: 'http://' + host };
  expect((await app.inject({ url: '/api/runtime', headers })).statusCode).toBe(200);
  const result = await app.inject({ method: 'POST', url: '/api/threads', headers: { ...headers, 'idempotency-key': randomUUID() }, payload: launch });
  expect(result.statusCode).toBe(202);
  const sockets = await pair(app, headers); expect(sockets.metadata.readyState).toBe(1); expect(sockets.terminal.readyState).toBe(1);
});
it('rejects different origins and untrusted hosts, and keeps unpaired non-loopback hosts out', async () => {
  const { app } = await setup('http://127.0.0.1:4321');
  for (const host of ['localhost.attacker.invalid:4321', 'attacker.invalid:4321']) expect((await app.inject({ url: '/api/runtime', headers: { host } })).statusCode).toBe(403);
  expect((await app.inject({ url: '/api/runtime', headers: { host: '192.0.2.1:4321' } })).statusCode).toBe(401);
  expect((await app.inject({ url: '/api/runtime', headers: { host: 'localhost:4322' } })).statusCode).toBe(200);
  for (const origin of ['http://127.0.0.1:4321', 'https://localhost:4321', 'http://localhost:4322']) {
    const headers = { host: 'localhost:4321', origin };
    expect((await app.inject({ method: 'POST', url: '/api/threads', headers, payload: launch })).statusCode).toBe(403);
    await expect(app.injectWS('/api/ws/metadata?instance=' + randomUUID(), { headers })).rejects.toThrow();
  }
  const remote = await setup('https://herdr.example:4321');
  expect((await remote.app.inject({ url: '/api/runtime', headers: { host: 'localhost:4321' } })).statusCode).toBe(200);
  expect((await remote.app.inject({ url: '/api/runtime', headers: remote.headers })).statusCode).toBe(401);
});
it('runs anonymous start → shared snapshot → binary baseline → ACK → input → release on one host', async () => {
  const { app, target, manager, headers } = await setup();
  const launchResult = await app.inject({ method: 'POST', url: '/api/threads', headers: { ...headers, 'idempotency-key': randomUUID() }, payload: launch });
  expect(launchResult.statusCode).toBe(202);
  const result = launchResult.json(); await expect.poll(() => manager.database.operation(result.operationId)?.state).toBe('ready');
  await expect.poll(() => manager.bootstrap().threads.find((thread) => thread.id === result.id)?.bindingState).toBe('attached');
  const first = await pair(app, headers); const second = await pair(app, headers);
  expect(target.activeSubscriptions).toBe(1); expect(first.records.length).toBeGreaterThan(0); expect(second.records.length).toBeGreaterThan(0);
  const thread = manager.bootstrap().threads.find((thread) => thread.id === result.id)!;
  const packets: Uint8Array[] = []; first.terminal.on('message', (data, binary) => { if (binary) packets.push(new Uint8Array(data as Buffer)); });
  first.terminal.send(JSON.stringify({ type: 'open', streamId: 1, generation: 1, machineId: target.id, threadId: thread.id, terminalId: thread.panes[0].terminalId, mode: 'control', takeover: false, cols: 80, rows: 24 }));
  await expect.poll(() => target.streams.length).toBe(1); target.streams[0].onFrame(frame());
  await expect.poll(() => packets.length).toBe(1); const decoded = decodeFrame(packets[0]); expect(decoded.full).toBe(true);
  first.terminal.send(JSON.stringify({ type: 'ack', streamId: 1, generation: 1, seq: decoded.seq }));
  await expect.poll(async () => (await app.inject({ url: '/api/stats', headers })).json().bytes).toBe(0);
  first.terminal.send(JSON.stringify({ type: 'input', streamId: 1, generation: 1, text: 'á🙂', paste: false }));
  await expect.poll(() => target.streams[0].commands.length).toBe(1); expect(target.streams[0].commands[0]).toEqual({ type: 'terminal.input', text: 'á🙂' });
  first.terminal.send(JSON.stringify({ type: 'release', streamId: 1, generation: 1 }));
  await expect.poll(() => target.streams[0].closed).toBe(true);
});
it('closes the companion socket when terminal is lost without requiring a login', async () => {
  const { app, headers } = await setup(); const sockets = await pair(app, headers);
  sockets.terminal.close();
  await expect.poll(() => sockets.metadata.readyState, { timeout: 4000 }).toBe(3);
  await expect.poll(() => sockets.terminal.readyState, { timeout: 4000 }).toBe(3);
  expect((await app.inject({ url: '/api/runtime', headers })).statusCode).toBe(200);
});
it('closes the companion socket when metadata is lost', async () => {
  const { app, headers } = await setup(); const sockets = await pair(app, headers);
  sockets.metadata.close(); await expect.poll(() => sockets.terminal.readyState).toBe(3);
});
it('validates strict actions and rejects an idempotency key reused for another payload', async () => {
  const { app, headers } = await setup(); const key = randomUUID();
  const post = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/threads', headers: { ...headers, 'idempotency-key': key }, payload });
  const first = await post(launch); expect(first.statusCode).toBe(202);
  const repeated = await post(launch); expect(repeated.json().id).toBe(first.json().id);
  expect((await post({ ...launch, prompt: 'Different' })).statusCode).toBe(409);
  expect((await post({ ...launch, shell: 'unsafe' })).statusCode).toBe(400);
});
it('shares one terminal control stream between two browser instances and releases it with the last one', async () => {
  const { app, headers, manager, target } = await setup();
  const first = await pair(app, headers); const second = await pair(app, headers);
  const thread = manager.bootstrap().threads[0];
  const action = { type: 'open', streamId: 1, generation: 1, machineId: target.id, threadId: thread.id, terminalId: thread.panes[0].terminalId, mode: 'control', takeover: false, cols: 80, rows: 24 };
  const notices: string[] = []; second.terminal.on('message', (data, binary) => { if (!binary) notices.push(data.toString()); });
  first.terminal.send(JSON.stringify(action)); await expect.poll(() => target.streams.length).toBe(1);
  second.terminal.send(JSON.stringify(action)); await expect.poll(() => notices.join('')).toContain('stream.opened');
  expect(target.streams).toHaveLength(1); expect(notices.join('')).not.toContain('controller_conflict');
  first.metadata.close(); await expect.poll(() => manager.bootstrap().threads.length).toBeGreaterThan(0);
  expect(target.streams[0].closed).toBe(false);
  second.metadata.close(); await expect.poll(() => target.streams[0].closed).toBe(true);
});

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 7)]);
const upload = (app: Awaited<ReturnType<typeof createHost>>, headers: Record<string, string>, body: Buffer, type = 'image/png', machineId = 'fixture') => app.inject({ method: 'POST', url: '/api/uploads?machineId=' + machineId, headers: { ...headers, 'content-type': type }, payload: body });
it('stores a pasted or dropped image privately and returns its absolute path', async () => {
  const { app, headers, uploadDirectory } = await setup();
  const response = await upload(app, headers, png); expect(response.statusCode).toBe(200);
  const { path } = response.json(); expect(path.startsWith(uploadDirectory + '/image-')).toBe(true); expect(path.endsWith('.png')).toBe(true);
  expect(await readFile(path)).toEqual(png); expect((await stat(path)).mode & 0o777).toBe(0o600); expect((await stat(uploadDirectory)).mode & 0o777).toBe(0o700);
});
it('refuses uploads from another origin, non-images, disguised files, oversized images and remote machines', async () => {
  const { app, headers, target } = await setup();
  expect((await upload(app, { ...headers, origin: 'http://evil.test' }, png)).statusCode).toBe(403);
  expect((await upload(app, headers, Buffer.from('hello'), 'text/plain')).json()).toEqual({ error: 'unsupported_image' });
  expect((await upload(app, headers, Buffer.alloc(5 * 1024 * 1024 + 1, 1), 'application/octet-stream')).json()).toEqual({ error: 'file_too_large' });
  expect((await upload(app, headers, Buffer.alloc(0), 'application/octet-stream')).statusCode).toBe(400);
  expect((await upload(app, headers, Buffer.from('<svg/>'), 'image/png')).json()).toEqual({ error: 'unsupported_image' });
  expect((await upload(app, headers, Buffer.alloc(21 * 1024 * 1024, 1))).json()).toEqual({ error: 'image_too_large' });
  expect((await upload(app, headers, png, 'image/png', 'missing')).json()).toEqual({ error: 'machine_disconnected' });
  target.acceptsLocalFiles = false; expect((await upload(app, headers, png)).json()).toEqual({ error: 'uploads_unsupported_target' });
});
it('stores any other file privately under a generated name that keeps its extension', async () => {
  const { app, headers, uploadDirectory } = await setup(); const pdf = Buffer.from('%PDF-1.7 hello');
  const response = await app.inject({ method: 'POST', url: '/api/uploads?machineId=fixture&name=' + encodeURIComponent('../My Report.PDF'), headers: { ...headers, 'content-type': 'application/octet-stream' }, payload: pdf });
  expect(response.statusCode).toBe(200); const { path } = response.json();
  expect(path).toMatch(new RegExp('^' + uploadDirectory + '/file-[0-9a-f-]{36}\\.pdf$')); expect(await readFile(path)).toEqual(pdf); expect((await stat(path)).mode & 0o777).toBe(0o600);
});
it('removes uploaded images after a week but keeps other files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hw-expiry-')); cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const store = new UploadStore(directory); const old = await store.save('image/png', png); const fresh = await store.save('image/png', png);
  await writeFile(join(directory, 'notes.txt'), 'keep'); const week = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000); await utimes(old, week, week);
  await store.removeExpired(); expect((await readdir(directory)).sort()).toEqual([fresh.split('/').at(-1), 'notes.txt'].sort());
});
it('answers invalid requests with 400 also when the production page renderer is mounted', async () => {
  const { app, headers } = await setup(origin, (_request, response) => { response.end(); });
  const response = await app.inject({ method: 'POST', url: '/api/threads/not-a-uuid/rename', headers, payload: { machineId: 'fixture', title: 'x' } });
  expect(response.statusCode).toBe(400); expect(response.json()).toEqual({ error: 'invalid_request' });
});
it('keeps the connection when a burst of valid terminal actions arrives at once', async () => {
  const { app, headers } = await setup();
  const { terminal } = await pair(app, headers);
  let closed = false; terminal.on('close', () => { closed = true; });
  for (let streamId = 1; streamId <= 40; streamId++) terminal.send(JSON.stringify({ type: 'release', streamId, generation: 1 }));
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(closed).toBe(false);
});
it('stores a custom project icon, serves it with a version, and resets to the default', async () => {
  const { app, headers, manager } = await setup();
  await expect.poll(() => manager.bootstrap().projects.length).toBeGreaterThan(0);
  const project = manager.bootstrap().projects[0];
  const query = `machineId=${project.machineId}&logicalId=${encodeURIComponent(project.logicalId ?? project.id)}`;
  const saved = await app.inject({ method: 'PUT', url: `/api/projects/icon?${query}`, headers: { ...headers, 'content-type': 'image/png' }, payload: png });
  expect(saved.statusCode).toBe(200);
  const custom = manager.bootstrap().projects[0];
  expect(custom.iconUrl).toMatch(/icon\?v=[0-9a-f]{8}$/);
  const served = await app.inject({ method: 'GET', url: custom.iconUrl!, headers });
  expect(served.rawPayload).toEqual(png);
  expect((await app.inject({ method: 'DELETE', url: `/api/projects/icon?${query}`, headers })).statusCode).toBe(200);
  expect(manager.bootstrap().projects[0].iconUrl ?? '').not.toContain('?v=');
});
