import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { MetadataDatabase } from '../src/server/storage/database';
import { createHost } from '../src/server/host';
import { RuntimeManager } from '../src/server/runtime/manager';
import { PairingService, RateLimiter, normalizeInviteToken } from '../src/server/auth/pairing';
import { deviceNameFrom } from '../src/server/auth/sessions';
import { FakeTarget } from './fixtures/target';

const cleanups: (() => Promise<unknown> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

const lan = '192.168.1.5:4321';
const phone = { host: lan, origin: 'http://' + lan, 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' };
const desktop = { host: 'localhost:4321', origin: 'http://localhost:4321' };
const remoteAddress = '192.168.1.20';

async function setup(origin = 'http://' + lan) {
  const database = new MetadataDatabase(':memory:'); cleanups.push(() => database.close());
  const manager = new RuntimeManager(database, [new FakeTarget()]);
  const app = await createHost(manager, origin, undefined, undefined, undefined, { publicUrls: ['http://' + lan] }); cleanups.push(() => app.close());
  const call = (method: 'GET' | 'POST', url: string, headers: Record<string, string>, payload?: unknown, remote = true) => app.inject({ method, url, headers, remoteAddress: remote ? remoteAddress : '127.0.0.1', payload: payload === undefined ? undefined : (payload as object) });
  const local = (method: 'GET' | 'POST', url: string, payload?: unknown) => call(method, url, desktop, payload, false);
  const cookieOf = (response: { headers: Record<string, unknown> }) => String(response.headers['set-cookie']).split(';')[0];
  return { app, database, call, local, cookieOf };
}

it('keeps loopback requests tokenless and everything else behind a device session', async () => {
  const { call, local } = await setup();
  expect((await local('GET', '/api/runtime')).statusCode).toBe(200);
  expect((await call('GET', '/api/runtime', phone)).statusCode).toBe(401);
  expect((await call('GET', '/api/runtime', { ...phone, accept: 'text/html' })).body).toContain('Request access');
  expect((await call('GET', '/api/auth/state', phone)).json()).toEqual({ local: false, authenticated: false });
  expect((await local('GET', '/api/auth/state')).json()).toEqual({ local: true, authenticated: false });
});

it('does not treat proxied loopback traffic as local', async () => {
  const { app } = await setup('https://mac.example.ts.net');
  const proxied = { host: 'mac.example.ts.net', 'x-forwarded-for': '100.64.0.2' };
  expect((await app.inject({ url: '/api/runtime', headers: proxied, remoteAddress: '127.0.0.1' })).statusCode).toBe(401);
  expect((await app.inject({ url: '/api/runtime', headers: { host: 'mac.example.ts.net', 'tailscale-user-login': 'a@b.c' }, remoteAddress: '127.0.0.1' })).statusCode).toBe(401);
  expect((await app.inject({ url: '/api/runtime', headers: { host: 'localhost:4321', 'x-forwarded-for': '100.64.0.2' }, remoteAddress: '127.0.0.1' })).statusCode).toBe(401);
});

it('pairs a device after approval from the local app and then serves it', async () => {
  const { call, local, cookieOf } = await setup();
  const request = (await call('POST', '/api/pair/request', phone, {})).json();
  expect(request.code).toMatch(/^\d{4}$/);
  expect((await call('POST', `/api/pair/request/${request.id}/poll`, phone, { secret: request.secret })).json()).toEqual({ status: 'pending' });
  expect((await local('GET', '/api/pair/pending')).json()).toEqual([{ id: request.id, code: request.code, deviceName: 'iPhone · Safari', expiresAt: request.expiresAt }]);
  expect((await call('GET', '/api/pair/pending', phone)).statusCode).toBe(401);
  expect((await local('POST', `/api/pair/${request.id}/approve`, {})).statusCode).toBe(200);
  const claimed = await call('POST', `/api/pair/request/${request.id}/poll`, phone, { secret: request.secret });
  expect(claimed.json()).toEqual({ status: 'approved' });
  expect(String(claimed.headers['set-cookie'])).toMatch(/HttpOnly; SameSite=Strict/);
  expect(String(claimed.headers['set-cookie'])).not.toMatch(/Secure/);
  const session = { ...phone, cookie: cookieOf(claimed) };
  expect((await call('GET', '/api/runtime', session)).statusCode).toBe(200);
  expect((await call('GET', '/api/auth/state', session)).json()).toEqual({ local: false, authenticated: true });
  expect((await call('POST', `/api/pair/request/${request.id}/poll`, phone, { secret: request.secret })).json()).toEqual({ status: 'expired' });
});

it('rejects a poll with the wrong secret and honours denial', async () => {
  const { call, local } = await setup();
  const request = (await call('POST', '/api/pair/request', phone, {})).json();
  expect((await call('POST', `/api/pair/request/${request.id}/poll`, phone, { secret: 'nope' })).json()).toEqual({ status: 'expired' });
  await local('POST', `/api/pair/${request.id}/deny`, {});
  const denied = await call('POST', `/api/pair/request/${request.id}/poll`, phone, { secret: request.secret });
  expect(denied.json()).toEqual({ status: 'denied' });
  expect(denied.headers['set-cookie']).toBeUndefined();
});

it('redeems a one-time invite exactly once', async () => {
  const { call, local, cookieOf } = await setup();
  const invite = (await local('POST', '/api/pair/invites', {})).json();
  expect(invite.token).toMatch(/^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/);
  expect(invite.urls).toEqual([`http://${lan}/#token=${normalizeInviteToken(invite.token)}`]);
  const redeemed = await call('POST', '/api/pair/redeem', phone, { token: invite.token.toLowerCase() });
  expect(redeemed.statusCode).toBe(200);
  expect((await call('GET', '/api/runtime', { ...phone, cookie: cookieOf(redeemed) })).statusCode).toBe(200);
  expect((await call('POST', '/api/pair/redeem', phone, { token: invite.token })).statusCode).toBe(403);
});

it('revokes a device, dropping its HTTP access and live sockets', async () => {
  const { app, call, local, cookieOf } = await setup();
  const invite = (await local('POST', '/api/pair/invites', {})).json();
  const session = { ...phone, cookie: cookieOf(await call('POST', '/api/pair/redeem', phone, { token: invite.token })) };
  await app.listen({ host: '127.0.0.1', port: 0 });
  const port = (app.server.address() as { port: number }).port;
  const socket = new WebSocket(`ws://127.0.0.1:${port}/api/ws/metadata?instance=${randomUUID()}`, { headers: { host: 'localhost:' + port, origin: 'http://localhost:' + port, cookie: session.cookie } });
  await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  const closed = new Promise<number>((resolve) => socket.once('close', resolve));
  const [device] = (await local('GET', '/api/devices')).json();
  expect(device).toMatchObject({ name: 'iPhone · Safari', current: false });
  expect((await local('POST', `/api/devices/${device.id}/revoke`, {})).statusCode).toBe(200);
  expect(await closed).toBe(1008);
  expect((await call('GET', '/api/runtime', session)).statusCode).toBe(401);
});

it('marks the cookie Secure on the configured HTTPS origin only', async () => {
  const { call, local } = await setup('https://mac.example.ts.net');
  const headers = { host: 'mac.example.ts.net', origin: 'https://mac.example.ts.net' };
  const invite = (await local('POST', '/api/pair/invites', {})).json();
  expect(String((await call('POST', '/api/pair/redeem', headers, { token: invite.token })).headers['set-cookie'])).toMatch(/; Secure/);
});

it('limits pairing floods and brute-force redemption', async () => {
  const { call } = await setup();
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 12; attempt++) statuses.push((await call('POST', '/api/pair/redeem', phone, { token: 'AAAA-AAAA-AAAA-AAAA' })).statusCode);
  expect(statuses.slice(0, 10).every((status) => status === 403)).toBe(true);
  expect(statuses.slice(10)).toEqual([429, 429]);
});

it('expires pending requests and invites, and caps pending requests', () => {
  let now = 1_000_000;
  const pairing = new PairingService(() => now);
  const invite = pairing.createInvite();
  for (let index = 0; index < 8; index++) pairing.request('Device');
  expect(() => pairing.request('Device')).toThrow('too_many_requests');
  now += 5 * 60_000 + 1;
  expect(pairing.pending()).toEqual([]);
  expect(pairing.redeemInvite(invite.token)).toBe(false);
});

it('rate limits per key within a window', () => {
  let now = 0;
  const limiter = new RateLimiter(2, 1000, () => now);
  expect([limiter.allow('a'), limiter.allow('a'), limiter.allow('a'), limiter.allow('b')]).toEqual([true, true, false, true]);
  now = 1001;
  expect(limiter.allow('a')).toBe(true);
});

it('names devices from their user agent', () => {
  expect(deviceNameFrom('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36 Edg/130')).toBe('Mac · Edge');
  expect(deviceNameFrom('Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile Safari/537.36')).toBe('Android · Chrome');
  expect(deviceNameFrom('')).toBe('Device');
});
