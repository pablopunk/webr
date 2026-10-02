import Fastify, { type FastifyRequest } from 'fastify';
import websocket from '@fastify/websocket';
import staticFiles from '@fastify/static';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { RuntimeManager } from './runtime/manager';
import { launchInput, opaqueId } from '../shared/runtime';
import { registerWebsockets } from './websockets';
import { createWorkspace } from './runtime/workspace';

const localOwner = 'local';
type SsrHandler = (request: FastifyRequest['raw'], response: import('node:http').ServerResponse, next: (error?: unknown) => void, locals: Record<string, unknown>) => void;

export async function createHost(manager: RuntimeManager, origin: string, ssr?: SsrHandler, tls?: { key: Buffer; cert: Buffer }, approveLaunch?: (selection: { machineId: string; projectId: string; agent: 'claude' | 'codex' | 'opencode'; model: string }) => Promise<boolean>) {
  const app = Fastify({ logger: false, bodyLimit: 16 * 1024, ...(tls ? { https: tls } : {}), requestTimeout: 10_000 });
  const configuredOrigin = new URL(origin);
  const allowedHosts = new Set([configuredOrigin.host]);
  if (['localhost', '127.0.0.1', '[::1]'].includes(configuredOrigin.hostname)) {
    for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
      const alias = new URL(origin); alias.hostname = hostname;
      allowedHosts.add(alias.host);
    }
  }
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', 'no-store');
    reply.header('Referrer-Policy', 'no-referrer');
    if (!request.headers.host || !allowedHosts.has(request.headers.host)) return reply.code(403).send({ error: 'invalid_host' });
    const upgrade = request.headers.upgrade === 'websocket';
    const requestOrigin = `${configuredOrigin.protocol}//${request.headers.host}`;
    if ((request.method !== 'GET' && request.method !== 'HEAD' || upgrade) && request.headers.origin !== requestOrigin) return reply.code(403).send({ error: 'invalid_origin' });
  });
  await app.register(websocket, { options: { maxPayload: 32 * 1024, perMessageDeflate: false } });
  const hub = registerWebsockets(app, manager);
  app.get('/api/catalog/machines', async () => manager.bootstrap().machines);
  app.get('/api/catalog/:machineId', async (request) => {
    const { machineId } = z.object({ machineId: opaqueId }).parse(request.params);
    const { projectId } = z.object({ projectId: opaqueId.optional() }).strict().parse(request.query);
    return manager.catalog(machineId, projectId);
  });
  app.post('/api/launch-approval', async (request, reply) => {
    const { consent: _consent, ...selection } = z.object({ machineId: opaqueId, projectId: opaqueId, agent: z.enum(['claude', 'codex', 'opencode']), model: z.string().regex(/^[A-Za-z0-9_/.:+-]{1,120}$/), consent: z.literal(true) }).strict().parse(request.body);
    if (!approveLaunch) return reply.code(501).send({ error: 'launch_validation_unavailable' });
    const supervisor = manager.supervisors.get(selection.machineId);
    if (!supervisor?.connected || !supervisor.target.locations.some((location) => location.projectId === selection.projectId)) return reply.code(409).send({ error: 'unknown_project_location' });
    const catalog = await manager.catalog(selection.machineId, selection.projectId);
    if (!catalog.harnesses.some((harness) => harness.id === selection.agent)) return reply.code(409).send({ error: 'harness_not_installed' });
    if (!await approveLaunch(selection)) return reply.code(409).send({ error: 'Launch validation failed; inspect .data/validation before retrying.' });
    manager.refreshCatalog(selection.machineId);
    return { approved: true };
  });
  app.get('/api/runtime', async () => manager.bootstrap());
  app.post('/api/workspaces', async (request, reply) => {
    const input = z.object({ machineId: opaqueId, path: z.string().startsWith('/').max(1000).refine((path) => !/[\x00-\x1f]/.test(path)), label: z.string().trim().min(1).max(80) }).strict().parse(request.body);
    const key = z.uuid().parse(request.headers['idempotency-key']);
    const supervisor = manager.supervisors.get(input.machineId);
    if (!supervisor?.connected) return reply.code(409).send({ error: 'machine_disconnected' });
    const result = await createWorkspace(manager.database, supervisor.target, key, input.path, input.label);
    supervisor.invalidate();
    return reply.code(result.state === 'unknown' ? 202 : 201).send(result);
  });
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
    const catalog = await manager.catalog(input.machineId, input.projectId);
    if (!catalog.harnesses.find((harness) => harness.id === input.agent)?.launchEnabled || supervisor.target.canLaunch && !supervisor.target.canLaunch(input)) return reply.code(409).send({ error: 'launch_capability_not_validated' });
    const result = manager.journal.submit(localOwner, key, input, supervisor.target);
    return reply.code(202).send(result);
  });
  app.post('/api/threads/:id/adopt', async (request) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const input = z.object({ machineId: opaqueId, terminalIds: z.array(opaqueId).min(1).max(256) }).strict().parse(request.body);
    await manager.adopt(input.machineId, id, input.terminalIds); return { adopted: true };
  });
  app.get('/api/operations/:id', async (request, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const operation = manager.database.operation(id);
    if (!operation || ![localOwner, manager.database.getSetting('allowed_account')].includes(operation.accountId)) return reply.code(404).send({ error: 'operation_not_found' });
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
      ssr(request.raw, reply.raw, () => { if (!reply.raw.headersSent) { reply.raw.statusCode = 404; reply.raw.end('Not found'); } }, { runtime: manager, accountId: localOwner });
    });
  }
  app.setErrorHandler((error, _request, reply) => {
    const message = error instanceof Error ? error.message : '';
    if (error instanceof z.ZodError) return reply.code(400).send({ error: 'invalid_request' });
    return reply.code(['idempotency_conflict', 'binding_conflict', 'invalid_adoption'].includes(message) ? 409 : 503).send({ error: ['idempotency_conflict', 'binding_conflict', 'invalid_adoption', 'machine_disconnected'].includes(message) ? message : 'request_failed' });
  });
  app.addHook('onClose', async () => manager.close());
  return app;
}
