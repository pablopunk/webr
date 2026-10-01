import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getMigrations } from 'better-auth/db/migration';
import { MetadataDatabase } from '../src/server/storage/database';
import { createAuth } from '../src/server/auth';
import { createHost } from '../src/server/host';
import { RuntimeManager } from '../src/server/runtime/manager';
import { FakeTarget, launch, frame } from './fixtures/target';
import { decodeFrame } from '../src/shared/frame';

const cleanups: (() => Promise<unknown> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const origin = 'http://localhost:4321';
let fixtureAddress = 1;
async function setup() {
  const database = new MetadataDatabase(':memory:'); cleanups.push(() => database.close());
  const secret = 'fixture-only-not-a-production-secret-12345';
  const provisioning = createAuth(database, origin, secret, true);
  await (await getMigrations(provisioning.auth.options)).runMigrations();
  const user = await provisioning.auth.api.signUpEmail({ body: { email: 'fixture@example.invalid', password: 'fixture-password-12345', name: 'Fixture' } });
  database.setSetting('allowed_account', user.user.id);
  const auth = createAuth(database, origin, secret);
  const target = new FakeTarget(); const manager = new RuntimeManager(database, [target]);
  const app = await createHost(manager, auth, origin); cleanups.push(() => app.close());
  manager.start(); await expect.poll(() => manager.bootstrap().machines[0].connected).toBe(true);
  const remoteAddress = '127.0.0.' + ++fixtureAddress;
  const signIn = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', remoteAddress, headers: { host: 'localhost:4321', origin }, payload: { email: 'fixture@example.invalid', password: 'fixture-password-12345' } });
  expect(signIn.statusCode).toBe(200);
  const cookie = signIn.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
  const headers = { host: 'localhost:4321', origin, cookie };
  return { database, auth, target, manager, app, headers, signIn };
}
async function pair(app: Awaited<ReturnType<typeof createHost>>, headers: Record<string, string>) {
  const instance = randomUUID(); const records: unknown[] = [];
  const metadata = await app.injectWS('/api/ws/metadata?instance=' + instance, { headers }, { onInit: (socket) => socket.on('message', (data) => records.push(JSON.parse(data.toString()))) });
  const terminal = await app.injectWS('/api/ws/terminal?instance=' + instance, { headers });
  cleanups.push(() => { metadata.close(); terminal.close(); });
  return { metadata, terminal, records };
}
it('guards all sensitive resources, SSR, signup, WS upgrades, Host and Origin', async () => {
  const { app, headers, signIn } = await setup();
  expect(signIn.headers['set-cookie']?.toString()).toContain('Secure'); expect(signIn.headers['set-cookie']?.toString()).toContain('HttpOnly');
  for (const url of ['/api/runtime', '/api/catalog/machines', '/api/stats', '/api/projects/project/icon']) expect((await app.inject({ url, headers: { host: 'localhost:4321' } })).statusCode).toBe(401);
  expect((await app.inject({ url: '/threads/' + randomUUID(), headers: { host: 'localhost:4321' } })).statusCode).toBe(302);
  expect((await app.inject({ method: 'POST', url: '/api/auth/sign-up/email', headers, payload: { email: 'other@example.invalid', password: 'other-password-12345', name: 'Other' } })).statusCode).not.toBe(200);
  expect((await app.inject({ url: '/api/runtime', headers: { ...headers, host: 'attacker.invalid' } })).statusCode).toBe(403);
  expect((await app.inject({ method: 'POST', url: '/api/threads', headers: { ...headers, origin: 'https://attacker.invalid' }, payload: launch })).statusCode).toBe(403);
  await expect(app.injectWS('/api/ws/metadata?instance=' + randomUUID(), { headers: { host: 'localhost:4321', origin } })).rejects.toThrow();
  await expect(app.injectWS('/api/ws/metadata?instance=' + randomUUID(), { headers: { ...headers, origin: 'https://attacker.invalid' } })).rejects.toThrow();
});
it('authenticates fake start → shared snapshot → binary baseline → ACK → input → release on one host', async () => {
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
it('revokes both open sockets on authoritative logout and rejects input after either socket is lost', async () => {
  const { app, headers } = await setup(); const sockets = await pair(app, headers);
  const signOut = await app.inject({ method: 'POST', url: '/api/auth/sign-out', headers, payload: {} }); expect(signOut.statusCode).toBe(200);
  await expect.poll(() => sockets.metadata.readyState, { timeout: 4000 }).toBe(3);
  await expect.poll(() => sockets.terminal.readyState, { timeout: 4000 }).toBe(3);
  expect((await app.inject({ url: '/api/runtime', headers })).statusCode).toBe(401);
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
it('rate limits authentication using the real peer address rather than a forged client header', async () => {
  const { app, headers } = await setup(); const statuses: number[] = [];
  for (let index = 0; index < 12; index++) statuses.push((await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', remoteAddress: '127.0.0.200', headers: { ...headers, 'x-herdr-web-client-ip': '192.0.2.' + index }, payload: { email: 'fixture@example.invalid', password: 'incorrect-password-12345' } })).statusCode);
  expect(statuses).toContain(429);
});
