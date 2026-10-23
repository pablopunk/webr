import { afterEach, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { MetadataDatabase } from '../src/server/storage/database';
import { createHost } from '../src/server/host';
import { RuntimeManager } from '../src/server/runtime/manager';
import { decodeSessionTabId, resolveSessionTab } from '../src/server/runtime/session-tab';
import { FakeTarget, launch, frame } from './fixtures/target';
import { decodeFrame } from '../src/shared/frame';
import { WebSocket } from 'ws';
import { mkdtemp, readFile, rm, stat, utimes, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UploadStore } from '../src/server/uploads';
import { SESSION_COOKIE } from '../src/server/auth/sessions';

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
it('returns an explicit uncertain outcome when a split reply cannot be correlated', async () => {
  const { app, target, manager, headers } = await setup();
  target.state.panes[0].agent = 'claude'; target.event!();
  await expect.poll(() => manager.bootstrap().threads.length).toBe(1);
  const thread = manager.bootstrap().threads[0];
  target.splitTerminal = async () => 'w1:p-unconfirmed';
  const response = await app.inject({ method: 'POST', url: `/api/threads/${thread.id}/panes/terminal`, headers, payload: { machineId: target.id, afterPaneId: 'w1:p1' } });
  expect(response.statusCode).toBe(503);
  expect(response.json()).toEqual({ error: 'pane_outcome_unknown' });
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
it('caches catalog results independently for each project', async () => {
  const { app, target, headers } = await setup();
  const requested: (string | undefined)[] = [];
  const original = target.catalog.bind(target);
  target.catalog = async (projectId?: string) => {
    requested.push(projectId);
    return { ...await original(), isGitRepo: projectId === target.id + ':project' };
  };
  const projectCatalog = await app.inject({ url: '/api/catalog/fixture?projectId=fixture%3Aproject', headers });
  const machineCatalog = await app.inject({ url: '/api/catalog/fixture', headers });
  expect(projectCatalog.json().isGitRepo).toBe(true);
  expect(machineCatalog.json().isGitRepo).toBe(false);
  expect(requested).toEqual(['fixture:project', undefined]);
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
it('validates strict actions and returns the durable operation envelope with compatibility aliases', async () => {
  const { app, headers } = await setup(); const key = randomUUID();
  const post = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/threads', headers: { ...headers, 'idempotency-key': key }, payload });
  const first = await post(launch); expect(first.statusCode).toBe(202);
  const accepted = first.json();
  expect(accepted).toMatchObject({ operationId: expect.any(String), kind: 'thread', state: 'pending', step: 'validate', result: { threadId: accepted.id }, statusUrl: `/api/operations/${accepted.operationId}` });
  const repeated = await post({ ...launch, prompt: '  Test launch  ', model: ' Default ' }); expect(repeated.json().id).toBe(accepted.id); expect(repeated.json().operationId).toBe(accepted.operationId);
  const status = await app.inject({ url: accepted.statusUrl, headers });
  expect(status.json()).toMatchObject({ operationId: accepted.operationId, id: accepted.operationId, threadId: accepted.id, result: { threadId: accepted.id }, statusUrl: accepted.statusUrl });
  expect((await post({ ...launch, prompt: 'Different' })).statusCode).toBe(409);
  expect((await post({ ...launch, shell: 'unsafe' })).statusCode).toBe(400);
});
it('returns 202 while catalog is pending and replays before disconnected-target checks', async () => {
  const { app, target, manager, headers } = await setup(); const key = randomUUID();
  let release!: () => void; let entered!: () => void;
  const enteredCatalog = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const catalog = target.catalog.bind(target);
  target.catalog = async () => { entered(); await gate; return catalog(); };
  const post = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/threads', headers: { ...headers, 'idempotency-key': key }, payload });
  const first = await post(launch); expect(first.statusCode).toBe(202); await enteredCatalog;
  const accepted = first.json(); expect(manager.database.operation(accepted.operationId)?.state).toBe('pending');
  target.lost!('machine_disconnected');
  manager.supervisors.get(target.id)!.stop();
  const repeated = await post(launch);
  expect(repeated.statusCode).toBe(202); expect(repeated.json().operationId).toBe(accepted.operationId);
  expect((await post({ ...launch, prompt: 'Different' })).statusCode).toBe(409);
  release();
  await expect.poll(() => manager.database.operation(accepted.operationId)?.state).toBe('failed');
  expect(target.effects).toEqual([]);
});
it('resolves concurrent duplicate and conflicting submissions to one durable intent', async () => {
  const { app, headers, manager } = await setup(); const key = randomUUID();
  const post = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/threads', headers: { ...headers, 'idempotency-key': key }, payload });
  const [first, repeated] = await Promise.all([post(launch), post(launch)]);
  expect(first.statusCode).toBe(202); expect(repeated.statusCode).toBe(202);
  expect(first.json().operationId).toBe(repeated.json().operationId);
  const conflictingKey = randomUUID();
  const simultaneous = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/threads', headers: { ...headers, 'idempotency-key': conflictingKey }, payload });
  const [accepted, conflict] = await Promise.all([simultaneous(launch), simultaneous({ ...launch, prompt: 'Different' })]);
  expect([accepted.statusCode, conflict.statusCode].sort()).toEqual([202, 409]);
  expect(manager.database.operations()).toHaveLength(2);
});
it('keeps operation status within existing owner visibility and includes a persisted recovery scope in runtime bootstrap', async () => {
  const { app, headers, manager, target } = await setup();
  const privateOperation = manager.journal.submit('another-account', randomUUID(), launch, target);
  expect((await app.inject({ url: privateOperation.statusUrl, headers })).statusCode).toBe(404);
  const runtime = await app.inject({ url: '/api/runtime', headers });
  expect(runtime.json().recoveryScope).toBe(manager.database.recoveryScope('local'));
  const remote = await setup('https://herdr.example:4321');
  const unauthenticated = await remote.app.inject({ url: privateOperation.statusUrl, headers: remote.headers });
  expect(unauthenticated.statusCode).toBe(401);
});
it('passes the authenticated owner into SSR bootstrap instead of using the local recovery scope', async () => {
  const ssr: NonNullable<Parameters<typeof createHost>[2]> = (_request, response, _next, locals) => {
    const owner = locals.accountId as string;
    const resourceOwner = locals.resourceAccountId as string;
    const bootstrap = (locals.runtime as RuntimeManager).bootstrap(owner, resourceOwner);
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ owner, recoveryScope: bootstrap.recoveryScope, resourceRecoveryScope: bootstrap.resourceRecoveryScope }));
  };
  const { app, headers, database, manager } = await setup(origin, ssr);
  const owner = 'remote-account';
  database.setSetting('allowed_account', owner);
  const token = 'authenticated-ssr-test-session';
  const now = Date.now();
  database.addDeviceSession({ id: randomUUID(), name: 'Remote device', createdAt: now, lastSeenAt: now, tokenHash: createHash('sha256').update(token).digest('hex') });

  const local = await app.inject({ url: '/new', headers });
  const authenticatedHeaders = { host: 'device.example.ts.net', cookie: `${SESSION_COOKIE}=${token}` };
  const authenticated = await app.inject({ url: '/new', headers: authenticatedHeaders });
  const runtime = await app.inject({ url: '/api/runtime', headers: authenticatedHeaders });
  expect(local.statusCode).toBe(200);
  expect(local.json()).toEqual({ owner: 'local', recoveryScope: manager.database.recoveryScope('local'), resourceRecoveryScope: manager.database.recoveryScope('local') });
  expect(authenticated.statusCode).toBe(200);
  expect(authenticated.json()).toEqual({ owner, recoveryScope: manager.database.recoveryScope(owner), resourceRecoveryScope: manager.database.recoveryScope(owner) });
  expect(authenticated.json().recoveryScope).not.toBe(local.json().recoveryScope);
  expect(runtime.json().recoveryScope).toBe(authenticated.json().recoveryScope);
});
it('accepts terminal creation before native work and serves status without replaying the effect', async () => {
  const { app, headers, manager, target } = await setup();
  const workspaceId = 'w2'; const tabId = 'w2:t1'; const paneId = 'w2:p1'; const terminalId = 'term_terminal';
  let requested: { path: string; label: string; requestId: string } | undefined;
  let release!: () => void; let entered!: () => void;
  const enteredNative = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  cleanups.push(() => release());
  const createWorkspace = vi.fn(async (path: string, label: string, requestId: string) => {
    requested = { path, label, requestId }; entered(); await gate;
    return { workspaceId, tabId, paneId, terminalId };
  });
  target.createWorkspace = createWorkspace;
  const key = randomUUID();
  const post = () => app.inject({ method: 'POST', url: '/api/terminals', headers: { ...headers, 'Idempotency-Key': key }, payload: { machineId: target.id, path: '~/' } });
  const response = await post();
  expect(response.statusCode).toBe(202);
  const accepted = response.json();
  expect(accepted).toMatchObject({ operationId: expect.any(String), kind: 'terminal', state: 'pending', step: 'validate', statusUrl: `/api/operations/${accepted.operationId}` });
  await enteredNative;
  expect(requested).toMatchObject({ path: '~/', label: 'Terminal', requestId: expect.any(String) });
  const repeated = await post();
  expect(repeated.statusCode).toBe(202); expect(repeated.json().operationId).toBe(accepted.operationId);
  expect(createWorkspace).toHaveBeenCalledOnce();
  const statusWhileRunning = await app.inject({ url: accepted.statusUrl, headers });
  expect(statusWhileRunning.json()).toMatchObject({ operationId: accepted.operationId, kind: 'terminal', state: 'running' });
  expect(createWorkspace).toHaveBeenCalledOnce();

  release();
  await expect.poll(() => manager.database.createOperation(accepted.operationId)?.state).toBe('ready');
  const completed = await app.inject({ url: accepted.statusUrl, headers });
  expect(completed.json()).toMatchObject({ operationId: accepted.operationId, kind: 'terminal', state: 'ready', result: { workspaceId, tabId, paneId, terminalId } });
  expect(manager.bootstrap().threads.some((item) => item.tabId === tabId)).toBe(false);
  const tab = manager.bootstrap().projections.find((projection) => projection.machineId === target.id)?.availableTabs?.find((item) => item.tabId === tabId);
  expect(tab).toMatchObject({ bound: false, panes: [{ id: paneId, terminalId, title: 'Shell' }] });
  const owner = 'remote-account';
  const route = await resolveSessionTab(manager, target.session, target.id, tabId, owner);
  expect(route.bootstrap.recoveryScope).toBe(manager.database.recoveryScope(owner));
  expect(route.page).toBe('terminal');
  expect(route.terminalPending).toBe(false);
  expect(route.terminalTab).toMatchObject({ tabId, bound: false, panes: [{ id: paneId, terminalId }] });
  expect(manager.terminalBinding(target.id, terminalId, { tabId })).toBe(target);
  expect(() => manager.terminalBinding(target.id, terminalId, { tabId: 'unknown' })).toThrow('binding_invalid');
  await manager.supervisors.get(target.id)!.readFresh();
  expect(manager.bootstrap().projections.find((projection) => projection.machineId === target.id)?.availableTabs).toContainEqual(expect.objectContaining({ tabId, panes: [expect.objectContaining({ id: paneId, terminalId })] }));
  const sockets = await pair(app, headers);
  sockets.terminal.send(JSON.stringify({ type: 'open', streamId: 1, generation: 1, machineId: target.id, tabId, terminalId, mode: 'control', takeover: false, cols: 80, rows: 24 }));
  await expect.poll(() => target.streams.length).toBe(1);
  expect(target.streams[0]?.closed).toBe(false);
  sockets.metadata.close();
});
it('accepts workspace creation immediately, normalizes labels, and replays recorded status before live checks', async () => {
  const { app, headers, manager, target } = await setup();
  const key = randomUUID(); let release!: () => void; let entered!: () => void;
  const enteredNative = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const created = { workspaceId: 'w3', tabId: 'w3:t1', paneId: 'w3:p1', terminalId: 'term_workspace' };
  const nativeCreate = vi.fn(async (_path: string, _label: string, _requestId: string) => { entered(); await gate; return created; });
  target.createWorkspace = nativeCreate;
  const post = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/workspaces', headers: { ...headers, 'Idempotency-Key': key }, payload });
  const [first, concurrent] = await Promise.all([
    post({ machineId: target.id, path: '/project', label: ' Project ' }),
    post({ machineId: target.id, path: '/project', label: 'Project' }),
  ]);
  expect(first.statusCode).toBe(202); expect(concurrent.statusCode).toBe(202);
  const accepted = first.json();
  expect(accepted).toMatchObject({ kind: 'workspace', state: 'pending', statusUrl: `/api/operations/${accepted.operationId}` });
  expect(concurrent.json().operationId).toBe(accepted.operationId);
  await enteredNative;
  const duplicate = await post({ machineId: target.id, path: '/project', label: 'Project' });
  expect(duplicate.statusCode).toBe(202); expect(duplicate.json().operationId).toBe(accepted.operationId);
  expect((await post({ machineId: target.id, path: '/other', label: 'Project' })).statusCode).toBe(409);
  expect(nativeCreate).toHaveBeenCalledOnce();
  release();
  await expect.poll(() => manager.database.createOperation(accepted.operationId)?.state).toBe('ready');
  manager.supervisors.get(target.id)!.stop();
  const afterDisconnect = await post({ machineId: target.id, path: '/project', label: 'Project' });
  expect(afterDisconnect.statusCode).toBe(202); expect(afterDisconnect.json().operationId).toBe(accepted.operationId);
  expect(afterDisconnect.json().result).toEqual(created);
  expect(nativeCreate).toHaveBeenCalledOnce();
});

it('scopes create idempotency to the authenticated owner and preserves operation visibility', async () => {
  const { app, headers, target, database } = await setup();
  const owner = 'remote-create-account'; database.setSetting('allowed_account', owner);
  const token = 'authenticated-create-test-session'; const now = Date.now();
  database.addDeviceSession({ id: randomUUID(), name: 'Remote device', createdAt: now, lastSeenAt: now, tokenHash: createHash('sha256').update(token).digest('hex') });
  target.createWorkspace = async () => ({ workspaceId: 'w4', tabId: 'w4:t1', paneId: 'w4:p1', terminalId: 'term_shared' });
  const key = randomUUID(); const payload = { machineId: target.id, path: '/shared', label: 'Shared' };
  const local = await app.inject({ method: 'POST', url: '/api/workspaces', headers: { ...headers, 'Idempotency-Key': key }, payload });
  const remoteHeaders = { host: 'device.example.ts.net', origin: 'http://device.example.ts.net', cookie: `${SESSION_COOKIE}=${token}`, 'Idempotency-Key': key };
  const remote = await app.inject({ method: 'POST', url: '/api/workspaces', headers: remoteHeaders, payload });
  expect(local.statusCode).toBe(202); expect(remote.statusCode).toBe(202);
  expect(local.json().operationId).not.toBe(remote.json().operationId);
  expect(database.createOperations().filter((operation) => operation.key === key).map((operation) => operation.accountId).sort()).toEqual(['local', owner].sort());
  expect((await app.inject({ method: 'POST', url: '/api/workspaces', headers: { ...remoteHeaders }, payload: { ...payload, label: 'Different' } })).statusCode).toBe(409);
  expect((await app.inject({ url: local.json().statusUrl, headers: remoteHeaders })).statusCode).toBe(200);
  const stranger = database.beginCreateOperation('stranger', 'workspace', randomUUID(), payload, { fingerprint: target.fingerprint, session: target.session, configVersion: target.configVersion }).operation;
  expect((await app.inject({ url: `/api/operations/${stranger.id}`, headers })).statusCode).toBe(404);
});

it('scopes accountless remote creates and recovery to the authenticated device session', async () => {
  const ssr: NonNullable<Parameters<typeof createHost>[2]> = (_request, response, _next, locals) => {
    const owner = locals.accountId as string;
    const resourceOwner = locals.resourceAccountId as string;
    const bootstrap = (locals.runtime as RuntimeManager).bootstrap(owner, resourceOwner);
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ owner, resourceOwner, recoveryScope: bootstrap.recoveryScope, resourceRecoveryScope: bootstrap.resourceRecoveryScope }));
  };
  const { app, headers, target, database } = await setup(origin, ssr);
  const now = Date.now();
  const sessions = [randomUUID(), randomUUID()];
  const tokens = ['remote-session-one', 'remote-session-two'];
  for (let index = 0; index < sessions.length; index++) database.addDeviceSession({ id: sessions[index], name: 'Remote device', createdAt: now, lastSeenAt: now, tokenHash: createHash('sha256').update(tokens[index]!).digest('hex') });
  target.createWorkspace = async () => ({ workspaceId: 'w5', tabId: 'w5:t1', paneId: 'w5:p1', terminalId: 'term_device' });
  const key = randomUUID(); const payload = { machineId: target.id, path: '/shared', label: 'Shared' };
  const remoteHeaders = (token: string) => ({ host: 'device.example.ts.net', origin: 'http://device.example.ts.net', cookie: `${SESSION_COOKIE}=${token}`, 'Idempotency-Key': key });
  const local = await app.inject({ method: 'POST', url: '/api/workspaces', headers: { ...headers, 'Idempotency-Key': key }, payload });
  const remote = await app.inject({ method: 'POST', url: '/api/workspaces', headers: remoteHeaders(tokens[0]!), payload });
  const duplicate = await app.inject({ method: 'POST', url: '/api/workspaces', headers: remoteHeaders(tokens[0]!), payload });
  expect(local.statusCode).toBe(202); expect(remote.statusCode).toBe(202);
  expect(remote.json().operationId).not.toBe(local.json().operationId);
  expect(duplicate.json().operationId).toBe(remote.json().operationId);
  expect(database.createOperations().filter((operation) => operation.key === key).map((operation) => operation.accountId).sort()).toEqual(['device:' + sessions[0], 'local'].sort());
  expect((await app.inject({ url: remote.json().statusUrl, headers: remoteHeaders(tokens[0]!) })).statusCode).toBe(200);
  expect((await app.inject({ url: remote.json().statusUrl, headers: remoteHeaders(tokens[1]!) })).statusCode).toBe(404);
  const localBootstrap = (await app.inject({ url: '/api/runtime', headers })).json();
  const firstBootstrap = (await app.inject({ url: '/api/runtime', headers: remoteHeaders(tokens[0]!) })).json();
  const secondBootstrap = (await app.inject({ url: '/api/runtime', headers: remoteHeaders(tokens[1]!) })).json();
  expect(new Set([localBootstrap.recoveryScope, firstBootstrap.recoveryScope, secondBootstrap.recoveryScope]).size).toBe(1);
  expect(new Set([localBootstrap.resourceRecoveryScope, firstBootstrap.resourceRecoveryScope, secondBootstrap.resourceRecoveryScope]).size).toBe(3);
  const pageResponse = await app.inject({ url: '/new', headers: remoteHeaders(tokens[0]!) });
  expect(pageResponse.json()).toEqual({ owner: 'local', resourceOwner: 'device:' + sessions[0], recoveryScope: localBootstrap.recoveryScope, resourceRecoveryScope: firstBootstrap.resourceRecoveryScope });
});

it('scopes accountless worktree operations and status to the authenticated device session', async () => {
  const { app, headers, target, database, manager } = await setup();
  cleanups.push(() => manager.close());
  const now = Date.now();
  const sessions = [randomUUID(), randomUUID()];
  const tokens = ['worktree-device-one', 'worktree-device-two'];
  for (let index = 0; index < sessions.length; index++) database.addDeviceSession({ id: sessions[index]!, name: 'Remote device', createdAt: now, lastSeenAt: now, tokenHash: createHash('sha256').update(tokens[index]!).digest('hex') });
  const openWorktree = vi.fn(async () => {});
  Object.assign(target, {
    worktrees: async () => [{ path: '/fixture', branch: 'main', label: 'Fixture', is_bare: false, is_prunable: false }],
    openWorktree,
  });
  const key = randomUUID();
  const payload = { machineId: target.id, projectId: 'fixture:project', path: '/fixture' };
  const remoteHeaders = (token: string) => ({ host: 'device.example.ts.net', origin: 'http://device.example.ts.net', cookie: `${SESSION_COOKIE}=${token}`, 'Idempotency-Key': key });

  const local = await app.inject({ method: 'POST', url: '/api/worktrees/open', headers: { ...headers, 'Idempotency-Key': key }, payload });
  const remote = await app.inject({ method: 'POST', url: '/api/worktrees/open', headers: remoteHeaders(tokens[0]!), payload });
  expect(local.statusCode).toBe(202); expect(remote.statusCode).toBe(202);
  expect(remote.json().operationId).not.toBe(local.json().operationId);
  await expect.poll(() => database.createOperation(local.json().operationId)?.state).toBe('ready');
  await expect.poll(() => database.createOperation(remote.json().operationId)?.state).toBe('ready');
  const duplicate = await app.inject({ method: 'POST', url: '/api/worktrees/open', headers: remoteHeaders(tokens[0]!), payload });
  expect(duplicate.json().operationId).toBe(remote.json().operationId);
  expect((await app.inject({ url: remote.json().statusUrl, headers: remoteHeaders(tokens[0]!) })).statusCode).toBe(200);
  expect((await app.inject({ url: remote.json().statusUrl, headers: remoteHeaders(tokens[1]!) })).statusCode).toBe(404);
  expect(database.createOperations().filter((operation) => operation.key === key).map((operation) => operation.accountId).sort()).toEqual(['device:' + sessions[0], 'local'].sort());
  expect(openWorktree).toHaveBeenCalledTimes(2);
});

it('decodes encoded standalone tab route IDs before resolving them', () => {
  expect(decodeSessionTabId(encodeURIComponent('w1:t1'))).toBe('w1:t1');
  expect(decodeSessionTabId('%E0%A4%A')).toBe('');
});
it('keeps a known machine terminal route pending instead of rendering a 404 for a missing snapshot tab', async () => {
  const { manager, target } = await setup();
  const route = await resolveSessionTab(manager, target.session, target.id, 'w1:still-starting', 'local');
  expect(route.page).toBe('terminal');
  expect(route.terminalPending).toBe(true);
  expect(route.terminalTab).toBeUndefined();
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
it('defaults uploaded files to a temporary directory outside the project', () => {
  const configuredDirectory = process.env.WEBR_UPLOADS;
  delete process.env.WEBR_UPLOADS;
  try { expect(new UploadStore().directory).toBe(join(tmpdir(), 'webr-uploads')); }
  finally { if (configuredDirectory !== undefined) process.env.WEBR_UPLOADS = configuredDirectory; }
});

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
  target.acceptsUploads = false; expect((await upload(app, headers, png)).json()).toEqual({ error: 'uploads_unsupported_target' });
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

it('rejects thread focus on a read-only machine without clearing the latch', async () => {
  const { app, headers, manager, target } = await setup();
  target.state.panes[0].agent_status = 'done'; target.event!();
  await expect.poll(() => manager.bootstrap().threads[0].unseenDone).toBe(true);
  const thread = manager.bootstrap().threads[0];
  target.writable = false;
  const response = await app.inject({ method: 'POST', url: `/api/threads/${thread.id}/focus`, headers, payload: { machineId: target.id, paneId: thread.panes[0].id } });
  expect(response.statusCode).toBe(403); expect(response.json()).toEqual({ error: 'read_only' });
  expect(target.focused).toHaveLength(0);
  expect(manager.bootstrap().threads[0].unseenDone).toBe(true);
});

it('marks a thread viewed through its local acknowledgement even when terminal control is read-only', async () => {
  const { app, headers, manager, target } = await setup();
  target.state.panes[0].agent_status = 'done'; target.event!();
  await expect.poll(() => manager.bootstrap().threads[0].unseenDone).toBe(true);
  const thread = manager.bootstrap().threads[0];
  target.writable = false;
  const response = await app.inject({ method: 'POST', url: `/api/threads/${thread.id}/viewed`, headers, payload: { machineId: target.id } });
  expect(response.statusCode).toBe(200); expect(response.json()).toEqual({ viewed: true, acked: true });
  expect(target.focused).toHaveLength(0);
  expect(manager.bootstrap().threads[0].unseenDone).toBe(false);
});

it('serves update status and starts updates only when a service is attached', async () => {
  const { app, headers } = await setup();
  expect((await app.inject({ method: 'GET', url: '/api/update', headers })).statusCode).toBe(404);
  const status = { current: '1.0.0', latest: '1.1.0', available: true, state: 'idle' as const };
  const started: string[] = [];
  const database = new MetadataDatabase(':memory:'); cleanups.push(() => database.close());
  const checked: string[] = [];
  const updates = { status: () => status, check: async () => { checked.push('check'); return status; }, start: () => { started.push('start'); return { ...status, state: 'updating' as const }; }, restart: () => { started.push('restart'); return status; } };
  const updating = await createHost(new RuntimeManager(database, [new FakeTarget()]), origin, undefined, undefined, undefined, {}, { updates }); cleanups.push(() => updating.close());
  expect((await updating.inject({ method: 'GET', url: '/api/update', headers })).json()).toEqual(status);
  expect((await updating.inject({ method: 'POST', url: '/api/update', headers })).statusCode).toBe(202);
  expect((await updating.inject({ method: 'POST', url: '/api/update/check', headers })).json()).toEqual(status);
  expect(checked).toEqual(['check']);
  expect((await updating.inject({ method: 'POST', url: '/api/restart', headers })).statusCode).toBe(202);
  expect(started).toEqual(['start', 'restart']);
});

it('exposes the resolved Herdr keymap', async () => {
  const { app } = await setup();
  const response = await app.inject({ url: '/api/herdr-keys', headers: { host: 'localhost:4321' } });
  expect(response.statusCode).toBe(200);
  const body = response.json() as { prefix: string; prefixes: string[]; bindings: Record<string, string[]> };
  expect(body.prefix).toEqual(expect.any(String));
  expect(body.prefixes).toContain(body.prefix);
  expect(body.bindings.close_pane.length).toBeGreaterThan(0);
  expect(body.bindings.split_vertical.length).toBeGreaterThan(0);
});
it('returns versioned metadata acknowledgements while keeping legacy response aliases', async () => {
  const { app, headers, manager, database } = await setup();
  await expect.poll(() => manager.bootstrap().threads.length).toBe(1);
  const threadId = manager.bootstrap().threads[0].id;
  const rename = await app.inject({ method: 'POST', url: `/api/threads/${threadId}/rename`, headers, payload: { machineId: 'fixture', title: '  New title  ' } });
  expect(rename.statusCode).toBe(200);
  expect(rename.json()).toEqual({ entityId: threadId, metadataVersion: 1, metadata: { titleOverride: 'New title', archivedAt: null }, title: 'New title' });
  const clear = await app.inject({ method: 'POST', url: `/api/threads/${threadId}/rename`, headers, payload: { machineId: 'fixture', title: null } });
  expect(clear.json()).toMatchObject({ entityId: threadId, metadataVersion: 2, metadata: { titleOverride: null, archivedAt: null }, title: 'Fixture tab' });
  expect(database.threadRows('fixture')[0].metadata.titleOverride).toBeUndefined();

  const archived = await app.inject({ method: 'POST', url: `/api/threads/${threadId}/archive`, headers, payload: { machineId: 'fixture', archived: true } });
  expect(archived.json()).toMatchObject({ entityId: threadId, metadataVersion: 3, metadata: { titleOverride: null }, archived: true });
  const project = await app.inject({ method: 'POST', url: '/api/projects/rename', headers, payload: { machineId: 'fixture', logicalId: 'project', name: 'Friendly project' } });
  expect(project.json()).toEqual({ machineId: 'fixture', entityId: 'project', metadataVersion: 1, metadata: { name: 'Friendly project' }, name: 'Friendly project' });
});
