import Fastify, { type FastifyRequest } from 'fastify';
import websocket from '@fastify/websocket';
import staticFiles from '@fastify/static';
import { fromNodeHeaders } from 'better-auth/node';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { RuntimeManager } from './runtime/manager';
import type { GatewayAuth } from './auth';
import { launchInput, opaqueId } from '../shared/runtime';
import { registerWebsockets } from './websockets';

declare module 'fastify' {
  interface FastifyRequest { gatewaySession: { accountId: string; sessionId: string; expiresAt: Date } | null }
}
type SsrHandler = (request: FastifyRequest['raw'], response: import('node:http').ServerResponse, next: (error?: unknown) => void, locals: Record<string, unknown>) => void;

export async function createHost(manager: RuntimeManager, auth: GatewayAuth, origin: string, ssr?: SsrHandler, tls?: { key: Buffer; cert: Buffer }) {
  const app = Fastify({ logger: false, bodyLimit: 16 * 1024, ...(tls ? { https: tls } : {}), requestTimeout: 10_000 });
  app.decorateRequest('gatewaySession', null);
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', 'no-store');
    reply.header('Referrer-Policy', 'no-referrer');
    if (request.headers.host !== new URL(origin).host) return reply.code(403).send({ error: 'invalid_host' });
    const upgrade = request.headers.upgrade === 'websocket';
    if ((request.method !== 'GET' && request.method !== 'HEAD' || upgrade) && request.headers.origin !== origin) return reply.code(403).send({ error: 'invalid_origin' });
    if (request.url.split('?')[0] === '/login' || request.url.startsWith('/api/auth/')) return;
    request.gatewaySession = await auth.authenticate(request.headers);
    if (!request.gatewaySession) {
      if (request.url.startsWith('/api/') || upgrade) return reply.code(401).send({ error: 'unauthorized' });
      return reply.redirect('/login');
    }
  });
  await app.register(websocket, { options: { maxPayload: 32 * 1024, perMessageDeflate: false } });
  const hub = registerWebsockets(app, manager, auth);
  app.get('/login', async (_request, reply) => reply.type('text/html').send(loginPage));
  app.route({ method: ['GET', 'POST'], url: '/api/auth/*', handler: async (request, reply) => {
    const headers = fromNodeHeaders(request.headers);
    headers.set('x-herdr-web-client-ip', request.ip);
    const response = await auth.auth.handler(new Request(origin + request.url, { method: request.method, headers, body: request.method === 'GET' ? undefined : JSON.stringify(request.body) }));
    reply.code(response.status);
    response.headers.forEach((value, key) => { if (key !== 'set-cookie') reply.header(key, value); });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) reply.header('set-cookie', cookies);
    return reply.send(await response.text());
  } });
  app.get('/api/catalog/machines', async () => manager.bootstrap().machines);
  app.get('/api/catalog/:machineId', async (request) => {
    const { machineId } = z.object({ machineId: opaqueId }).parse(request.params);
    return manager.catalog(machineId);
  });
  app.get('/api/runtime', async () => manager.bootstrap());
  app.get('/api/projects/:machineId/:projectId/icon', async (request, reply) => {
    const { machineId, projectId } = z.object({ machineId: opaqueId, projectId: opaqueId }).parse(request.params);
    const target = manager.supervisors.get(machineId)?.target;
    const icon = await target?.icon?.(projectId);
    if (!icon) return reply.code(404).send();
    if (icon.contentType === 'image/svg+xml') reply.header('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'");
    return reply.type(icon.contentType).send(icon.bytes);
  });
  app.post('/api/threads', async (request, reply) => {
    const input = launchInput.parse(request.body);
    const key = z.uuid().parse(request.headers['idempotency-key']);
    const supervisor = manager.supervisors.get(input.machineId);
    if (!supervisor?.connected) return reply.code(409).send({ error: 'machine_disconnected' });
    const catalog = await manager.catalog(input.machineId);
    if (!catalog.harnesses.find((harness) => harness.id === input.agent)?.launchEnabled) return reply.code(409).send({ error: 'launch_capability_not_validated' });
    const result = manager.journal.submit(request.gatewaySession!.accountId, key, input, supervisor.target);
    return reply.code(202).send(result);
  });
  app.post('/api/threads/:id/adopt', async (request) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const input = z.object({ machineId: opaqueId, terminalIds: z.array(opaqueId).min(1).max(16) }).strict().parse(request.body);
    manager.adopt(input.machineId, id, input.terminalIds); return { adopted: true };
  });
  app.get('/api/operations/:id', async (request, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const operation = manager.database.operation(id);
    if (!operation || operation.accountId !== request.gatewaySession?.accountId) return reply.code(404).send({ error: 'operation_not_found' });
    return { id: operation.id, state: operation.state, step: operation.step, threadId: operation.threadId };
  });
  app.get('/api/stats', async () => hub.stats());
  if (ssr) {
    await app.register(staticFiles, { root: resolve('dist/client'), serve: false });
    app.get('/_astro/*', async (request, reply) => {
      const path = z.string().regex(/^[A-Za-z0-9_./-]+$/).parse((request.params as { '*': string })['*']);
      const full = resolve('dist/client/_astro', path);
      if (!full.startsWith(resolve('dist/client/_astro') + '/')) return reply.code(404).send();
      return reply.sendFile(path, resolve('dist/client/_astro'));
    });
    app.get('/*', async (request, reply) => {
      reply.hijack();
      ssr(request.raw, reply.raw, () => { if (!reply.raw.headersSent) { reply.raw.statusCode = 404; reply.raw.end('Not found'); } }, { runtime: manager, accountId: request.gatewaySession!.accountId });
    });
  }
  app.setErrorHandler((error, _request, reply) => {
    const message = error instanceof Error ? error.message : '';
    if (error instanceof z.ZodError) return reply.code(400).send({ error: 'invalid_request' });
    return reply.code(message === 'idempotency_conflict' ? 409 : 503).send({ error: ['idempotency_conflict', 'binding_conflict', 'invalid_adoption', 'machine_disconnected'].includes(message) ? message : 'request_failed' });
  });
  app.addHook('onClose', async () => manager.close());
  return app;
}

const loginPage = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Sign in · Herdr</title><style>body{font:16px system-ui;max-width:360px;margin:15vh auto;padding:24px}input,button{box-sizing:border-box;width:100%;padding:12px;margin:8px 0}p{color:#b22}</style><h1>Sign in</h1><form><input type="email" name="email" autocomplete="username" aria-label="Email" required><input type="password" name="password" autocomplete="current-password" aria-label="Password" required><button>Sign in</button><p role="alert"></p></form><script>document.querySelector('form').addEventListener('submit',async event=>{event.preventDefault();const form=new FormData(event.target);const response=await fetch('/api/auth/sign-in/email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:form.get('email'),password:form.get('password')})});if(response.ok)location.href='/';else document.querySelector('p').textContent='Sign in failed.';});</script></html>`;
