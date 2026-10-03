import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import type { MetadataDatabase } from '../storage/database';
import { isLocalRequest, isLoopbackAddress, sourceAddress } from './access';
import { AuditLog } from './audit';
import { ApproverPresence } from './presence';
import { pairPage } from './pair-page';
import { PairingService, RateLimiter, formatInviteToken } from './pairing';
import { SessionStore, clearedSessionCookie, deviceNameFrom, sessionCookie, type DeviceSession } from './sessions';

export type AuthOptions = { publicUrls?: string[]; tailscale?: 'ready' | 'https-disabled' | 'unavailable' };
export type Access = { local: boolean; session?: DeviceSession };

const publicRoutes: [method: string, path: RegExp][] = [
  ['GET', /^\/api\/auth\/state$/],
  ['POST', /^\/api\/pair\/request$/],
  ['POST', /^\/api\/pair\/request\/[^/]+\/poll$/],
  ['POST', /^\/api\/pair\/redeem$/],
  ['GET', /^\/[a-z0-9-]+\.(?:png|ico|webmanifest)$/],
];
const idParams = z.object({ id: z.uuid() });
const emptyBody = z.object({}).strict();
const sourceOf = (request: FastifyRequest) => sourceAddress(request.ip);
const deviceOf = (request: FastifyRequest) => deviceNameFrom(request.headers['user-agent']);

export class Auth {
  readonly sessions: SessionStore;
  readonly pairing = new PairingService();
  readonly audit: AuditLog;
  private readonly presence = new ApproverPresence();
  private readonly accessByRequest = new WeakMap<object, Access>();
  private readonly deviceBySocket = new WeakMap<object, string>();

  constructor(database: MetadataDatabase, private readonly origin: URL, private readonly options: AuthOptions = {}) {
    this.audit = new AuditLog(database);
    this.sessions = new SessionStore(database, Date.now, this.audit);
  }

  access(request: FastifyRequest): Access { return this.accessByRequest.get(request.raw) ?? { local: false }; }

  guard(request: FastifyRequest, reply: FastifyReply) {
    const access: Access = { local: isLocalRequest(request.raw), session: this.sessions.authenticate(request.headers.cookie, sourceOf(request)) };
    this.accessByRequest.set(request.raw, access);
    if (access.local || access.session || this.isPublic(request)) return undefined;
    if (request.method === 'GET' && request.headers.accept?.includes('text/html')) return reply.code(401).type('text/html').send(pairPage());
    return reply.code(401).send({ error: 'unauthorized' });
  }

  private isHttpsThroughLocalProxy(request: FastifyRequest) { return request.headers['x-forwarded-proto'] === 'https' && isLoopbackAddress(request.socket.remoteAddress); }

  private protocolOf(request: FastifyRequest) {
    if (request.headers.host === this.origin.host) return this.origin.protocol;
    return this.isHttpsThroughLocalProxy(request) ? 'https:' : `${request.protocol}:`;
  }

  expectedOrigin(request: FastifyRequest) {
    return `${this.protocolOf(request)}//${request.headers.host}`;
  }

  routes(app: FastifyInstance) {
    const requestLimiter = new RateLimiter(6, 60_000);
    const redeemLimiter = new RateLimiter(10, 60_000);
    app.websocketServer.on('connection', (socket: WebSocket, request) => { const id = this.accessByRequest.get(request)?.session?.id; if (id) this.deviceBySocket.set(socket, id); });

    app.get('/api/auth/state', async (request) => { const { local, session } = this.access(request); return { local, authenticated: !!session }; });
    app.post('/api/pair/request', async (request, reply) => {
      if (!requestLimiter.allow(request.ip)) return reply.code(429).send({ error: 'rate_limited' });
      try {
        const created = this.pairing.request(deviceOf(request), sourceOf(request));
        this.audit.record('pair_requested', { source: sourceOf(request), deviceName: deviceOf(request) });
        return created;
      } catch (error) { return reply.code(429).send({ error: error instanceof Error && error.message === 'cooling_down' ? 'cooling_down' : 'too_many_requests' }); }
    });
    app.post('/api/pair/request/:id/poll', async (request, reply) => {
      const { id } = idParams.parse(request.params);
      const { secret } = z.object({ secret: z.string().min(1).max(100) }).strict().parse(request.body);
      const result = this.pairing.claim(id, secret);
      if (result.status === 'approved') this.grant(request, reply, result.deviceName!);
      return result.status === 'pending' ? { status: result.status, approverOnline: this.presence.attentive() } : { status: result.status };
    });
    app.post('/api/pair/redeem', async (request, reply) => {
      if (!redeemLimiter.allow(request.ip)) return reply.code(429).send({ error: 'rate_limited' });
      const { token } = z.object({ token: z.string().min(1).max(64) }).strict().parse(request.body);
      if (!this.pairing.redeemInvite(token)) return reply.code(403).send({ error: 'invalid_token' });
      this.audit.record('invite_redeemed', { source: sourceOf(request), deviceName: deviceOf(request) });
      this.grant(request, reply, deviceOf(request));
      return { ok: true };
    });

    app.get('/api/pair/pending', async () => { this.presence.seen(); return this.pairing.pending(); });
    for (const [action, state] of [['approve', 'approved'], ['deny', 'denied']] as const) {
      app.post(`/api/pair/:id/${action}`, async (request, reply) => {
        const { id } = idParams.parse(request.params);
        emptyBody.parse(request.body);
        const decided = this.pairing.decide(id, state);
        if (!decided) return reply.code(404).send({ error: 'request_not_found' });
        this.audit.record(state === 'approved' ? 'pair_approved' : 'pair_denied', decided);
        return { [state]: true };
      });
    }
    app.post('/api/pair/invites', async (request) => {
      const invite = this.pairing.createInvite();
      this.audit.record('invite_created', { source: sourceOf(request) });
      return { token: formatInviteToken(invite.token), expiresAt: invite.expiresAt, urls: (this.options.publicUrls ?? []).map((base) => `${base}/#token=${invite.token}`) };
    });
    app.get('/api/remote/tailscale', async () => ({ status: this.options.tailscale ?? 'ready' }));
    app.get('/api/audit', async () => this.audit.recent());
    app.get('/api/devices', async (request) => this.sessions.list().map((device) => ({ ...device, current: device.id === this.access(request).session?.id })));
    app.post('/api/devices/:id/revoke', async (request, reply) => {
      const { id } = idParams.parse(request.params);
      emptyBody.parse(request.body);
      const device = this.sessions.list().find((candidate) => candidate.id === id);
      if (!device || !this.revoke(app, id)) return reply.code(404).send({ error: 'device_not_found' });
      this.audit.record('device_revoked', { source: sourceOf(request), deviceName: device.name });
      return { revoked: true };
    });
    app.post('/api/auth/logout', async (request, reply) => {
      const session = this.access(request).session;
      if (session && this.revoke(app, session.id)) this.audit.record('device_revoked', { source: sourceOf(request), deviceName: session.name });
      reply.header('Set-Cookie', clearedSessionCookie(this.isSecure(request)));
      return { ok: true };
    });
  }

  private isPublic(request: FastifyRequest) {
    const path = request.url.split('?')[0];
    return publicRoutes.some(([method, pattern]) => method === request.method && pattern.test(path));
  }

  private isSecure(request: FastifyRequest) { return this.protocolOf(request) === 'https:'; }

  private grant(request: FastifyRequest, reply: FastifyReply, deviceName: string) {
    reply.header('Set-Cookie', sessionCookie(this.sessions.create(deviceName).token, this.isSecure(request)));
  }

  private revoke(app: FastifyInstance, id: string) {
    const revoked = this.sessions.revoke(id);
    for (const socket of app.websocketServer.clients) if (this.deviceBySocket.get(socket) === id) socket.close(1008);
    return revoked;
  }
}
