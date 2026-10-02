import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import type { MetadataDatabase } from '../storage/database';
import { isLocalRequest } from './access';
import { pairPage } from './pair-page';
import { PairingService, RateLimiter, formatInviteToken } from './pairing';
import { SessionStore, clearedSessionCookie, deviceNameFrom, sessionCookie, type DeviceSession } from './sessions';

export type AuthOptions = { publicUrls?: string[] };
export type Access = { local: boolean; session?: DeviceSession };

const publicRoutes: [method: string, path: RegExp][] = [
  ['GET', /^\/api\/auth\/state$/],
  ['POST', /^\/api\/pair\/request$/],
  ['POST', /^\/api\/pair\/request\/[^/]+\/poll$/],
  ['POST', /^\/api\/pair\/redeem$/],
];
const idParams = z.object({ id: z.uuid() });
const emptyBody = z.object({}).strict();

export class Auth {
  readonly sessions: SessionStore;
  readonly pairing = new PairingService();
  private readonly accessByRequest = new WeakMap<object, Access>();
  private readonly deviceBySocket = new WeakMap<object, string>();

  constructor(database: MetadataDatabase, private readonly origin: URL, private readonly options: AuthOptions = {}) {
    this.sessions = new SessionStore(database);
  }

  access(request: FastifyRequest): Access { return this.accessByRequest.get(request.raw) ?? { local: false }; }

  guard(request: FastifyRequest, reply: FastifyReply) {
    const access: Access = { local: isLocalRequest(request.raw), session: this.sessions.authenticate(request.headers.cookie) };
    this.accessByRequest.set(request.raw, access);
    if (access.local || access.session || this.isPublic(request)) return undefined;
    if (request.method === 'GET' && request.headers.accept?.includes('text/html')) return reply.code(401).type('text/html').send(pairPage());
    return reply.code(401).send({ error: 'unauthorized' });
  }

  expectedOrigin(request: FastifyRequest) {
    return `${request.headers.host === this.origin.host ? this.origin.protocol : `${request.protocol}:`}//${request.headers.host}`;
  }

  routes(app: FastifyInstance) {
    const requestLimiter = new RateLimiter(6, 60_000);
    const redeemLimiter = new RateLimiter(10, 60_000);
    app.websocketServer.on('connection', (socket: WebSocket, request) => { const id = this.accessByRequest.get(request)?.session?.id; if (id) this.deviceBySocket.set(socket, id); });

    app.get('/api/auth/state', async (request) => { const { local, session } = this.access(request); return { local, authenticated: !!session }; });
    app.post('/api/pair/request', async (request, reply) => {
      if (!requestLimiter.allow(request.ip)) return reply.code(429).send({ error: 'rate_limited' });
      try { return this.pairing.request(deviceNameFrom(request.headers['user-agent'])); }
      catch { return reply.code(429).send({ error: 'too_many_requests' }); }
    });
    app.post('/api/pair/request/:id/poll', async (request, reply) => {
      const { id } = idParams.parse(request.params);
      const { secret } = z.object({ secret: z.string().min(1).max(100) }).strict().parse(request.body);
      const result = this.pairing.claim(id, secret);
      if (result.status === 'approved') this.grant(request, reply, result.deviceName!);
      return { status: result.status };
    });
    app.post('/api/pair/redeem', async (request, reply) => {
      if (!redeemLimiter.allow(request.ip)) return reply.code(429).send({ error: 'rate_limited' });
      const { token } = z.object({ token: z.string().min(1).max(64) }).strict().parse(request.body);
      if (!this.pairing.redeemInvite(token)) return reply.code(403).send({ error: 'invalid_token' });
      this.grant(request, reply, deviceNameFrom(request.headers['user-agent']));
      return { ok: true };
    });

    app.get('/api/pair/pending', async () => this.pairing.pending());
    for (const [action, state] of [['approve', 'approved'], ['deny', 'denied']] as const) {
      app.post(`/api/pair/:id/${action}`, async (request, reply) => {
        const { id } = idParams.parse(request.params);
        emptyBody.parse(request.body);
        return this.pairing.decide(id, state) ? { [state]: true } : reply.code(404).send({ error: 'request_not_found' });
      });
    }
    app.post('/api/pair/invites', async () => {
      const invite = this.pairing.createInvite();
      return { token: formatInviteToken(invite.token), expiresAt: invite.expiresAt, urls: (this.options.publicUrls ?? []).map((base) => `${base}/#token=${invite.token}`) };
    });
    app.get('/api/devices', async (request) => this.sessions.list().map((device) => ({ ...device, current: device.id === this.access(request).session?.id })));
    app.post('/api/devices/:id/revoke', async (request, reply) => {
      const { id } = idParams.parse(request.params);
      emptyBody.parse(request.body);
      if (!this.revoke(app, id)) return reply.code(404).send({ error: 'device_not_found' });
      return { revoked: true };
    });
    app.post('/api/auth/logout', async (request, reply) => {
      const session = this.access(request).session;
      if (session) this.revoke(app, session.id);
      reply.header('Set-Cookie', clearedSessionCookie(this.isSecure(request)));
      return { ok: true };
    });
  }

  private isPublic(request: FastifyRequest) {
    const path = request.url.split('?')[0];
    return publicRoutes.some(([method, pattern]) => method === request.method && pattern.test(path));
  }

  private isSecure(request: FastifyRequest) { return this.origin.protocol === 'https:' && request.headers.host === this.origin.host; }

  private grant(request: FastifyRequest, reply: FastifyReply, deviceName: string) {
    reply.header('Set-Cookie', sessionCookie(this.sessions.create(deviceName).token, this.isSecure(request)));
  }

  private revoke(app: FastifyInstance, id: string) {
    const revoked = this.sessions.revoke(id);
    for (const socket of app.websocketServer.clients) if (this.deviceBySocket.get(socket) === id) socket.close(1008);
    return revoked;
  }
}
