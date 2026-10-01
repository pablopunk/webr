import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { MetadataDatabase } from '../src/server/storage/database';
import { createHost } from '../src/server/host';
import { RuntimeManager } from '../src/server/runtime/manager';
import { FakeTarget, launch, frame } from './fixtures/target';
import { decodeFrame } from '../src/shared/frame';
import { WebSocket } from 'ws';

const cleanups: (() => Promise<unknown> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const origin = 'http://localhost:4321';
async function setup(serverOrigin = origin) {
  const database = new MetadataDatabase(':memory:'); cleanups.push(() => database.close());
  const target = new FakeTarget(); const manager = new RuntimeManager(database, [target]);
  const app = await createHost(manager, serverOrigin); cleanups.push(() => app.close());
  manager.start(); await expect.poll(() => manager.bootstrap().machines[0].connected).toBe(true);
  const headers = { host: new URL(serverOrigin).host, origin: serverOrigin };
  return { database, target, manager, app, headers };
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
it('rejects different origins, ports, suffix hosts and nonlocal aliases even when loopback is allowed', async () => {
  const { app } = await setup('http://127.0.0.1:4321');
  for (const host of ['localhost:4322', 'localhost.attacker.invalid:4321', '192.0.2.1:4321']) expect((await app.inject({ url: '/api/runtime', headers: { host } })).statusCode).toBe(403);
  for (const origin of ['http://127.0.0.1:4321', 'https://localhost:4321', 'http://localhost:4322']) {
    const headers = { host: 'localhost:4321', origin };
    expect((await app.inject({ method: 'POST', url: '/api/threads', headers, payload: launch })).statusCode).toBe(403);
    await expect(app.injectWS('/api/ws/metadata?instance=' + randomUUID(), { headers })).rejects.toThrow();
  }
  const remote = await setup('https://herdr.example:4321');
  expect((await remote.app.inject({ url: '/api/runtime', headers: { host: 'localhost:4321' } })).statusCode).toBe(403);
  expect((await remote.app.inject({ url: '/api/runtime', headers: remote.headers })).statusCode).toBe(200);
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
it('refuses two browser instances controlling the same terminal and releases on disconnect', async () => {
  const { app, headers, manager, target } = await setup();
  const first = await pair(app, headers); const second = await pair(app, headers);
  const thread = manager.bootstrap().threads[0];
  const action = { type: 'open', streamId: 1, generation: 1, machineId: target.id, threadId: thread.id, terminalId: thread.panes[0].terminalId, mode: 'control', takeover: false, cols: 80, rows: 24 };
  const errors: string[] = []; second.terminal.on('message', (data, binary) => { if (!binary) errors.push(data.toString()); });
  first.terminal.send(JSON.stringify(action)); await expect.poll(() => target.streams.length).toBe(1);
  second.terminal.send(JSON.stringify(action)); await expect.poll(() => errors.join('')).toContain('controller_conflict');
  first.metadata.close(); await expect.poll(() => target.streams[0].closed).toBe(true);
});
