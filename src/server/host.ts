import Fastify, { type FastifyRequest } from 'fastify';
import websocket from '@fastify/websocket';
import staticFiles from '@fastify/static';
import { resolve } from 'node:path';
import { distRoot } from './dist';
import { z } from 'zod';
import type { RuntimeManager } from './runtime/manager';
import { launchInput, opaqueId } from '../shared/runtime';
import { registerWebsockets } from './websockets';
import { createWorkspace } from './runtime/workspace';
import { perfLog, perfLogEnabled } from './perf-log';
import { Auth, type AuthOptions } from './auth/auth';
import { isTrustedHost } from './auth/access';
import { registerDevHmrProxy } from './dev-hmr-proxy';
import { registerVoiceRoutes } from './voice/routes';
import type { Transcriber } from './voice/transcriber';
import { MAX_IMAGE_BYTES, UploadStore, isFileUpload, uploadContentTypes } from './uploads';

const localOwner = 'local';
type SsrHandler = (request: FastifyRequest['raw'], response: import('node:http').ServerResponse, next: (error?: unknown) => void, locals: Record<string, unknown>) => void;

const MAX_PROJECT_ICON_BYTES = 512 * 1024;

export async function createHost(manager: RuntimeManager, origin: string, ssr?: SsrHandler, tls?: { key: Buffer; cert: Buffer }, uploads = new UploadStore(), authOptions: AuthOptions = {}, { devHmrPort, transcriber }: { devHmrPort?: number; transcriber?: Transcriber } = {}) {
  const app = Fastify({ logger: false, bodyLimit: 16 * 1024, ...(tls ? { https: tls } : {}), requestTimeout: 10_000 });
  const configuredOrigin = new URL(origin);
  const auth = new Auth(manager.database, configuredOrigin, authOptions);
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', 'no-store');
    reply.header('Referrer-Policy', 'no-referrer');
    if (!isTrustedHost(request.headers.host, configuredOrigin.host)) return reply.code(403).send({ error: 'invalid_host' });
    const upgrade = request.headers.upgrade === 'websocket';
    if ((request.method !== 'GET' && request.method !== 'HEAD' || upgrade) && request.headers.origin !== auth.expectedOrigin(request)) return reply.code(403).send({ error: 'invalid_origin' });
    return auth.guard(request, reply);
  });
  app.setErrorHandler((error, _request, reply) => {
    const message = error instanceof Error ? error.message : '';
    if (error instanceof z.ZodError) return reply.code(400).send({ error: 'invalid_request' });
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 413) return reply.code(413).send({ error: 'image_too_large' });
    if (message === 'file_too_large') return reply.code(413).send({ error: message });
    if (message === 'empty_file') return reply.code(400).send({ error: message });
    if (status === 415 || message === 'unsupported_image') return reply.code(415).send({ error: 'unsupported_image' });
    if (status && status >= 400 && status < 500) return reply.code(status).send({ error: 'invalid_request' });
    if (message === 'thread_not_found') return reply.code(404).send({ error: message });
    if (message === 'launch_in_progress') return reply.code(409).send({ error: message });
    return reply.code(['idempotency_conflict', 'binding_conflict', 'invalid_adoption'].includes(message) ? 409 : 503).send({ error: ['idempotency_conflict', 'binding_conflict', 'invalid_adoption', 'machine_disconnected'].includes(message) ? message : 'request_failed' });
  });
  await app.register(websocket, { options: { maxPayload: 32 * 1024, perMessageDeflate: false } });
  const hub = registerWebsockets(app, manager);
  auth.routes(app);
  if (devHmrPort) registerDevHmrProxy(app, devHmrPort);
  if (transcriber) registerVoiceRoutes(app, transcriber);
  app.get('/api/catalog/machines', async () => manager.bootstrap().machines);
  app.get('/api/catalog/:machineId', async (request) => {
    const { machineId } = z.object({ machineId: opaqueId }).parse(request.params);
    const { projectId } = z.object({ projectId: opaqueId.optional() }).strict().parse(request.query);
    return manager.catalog(machineId, projectId);
  });
  app.get('/api/runtime', async () => manager.bootstrap());
  app.addContentTypeParser(uploadContentTypes, { parseAs: 'buffer', bodyLimit: MAX_IMAGE_BYTES }, (_request, body, done) => done(null, body));
  app.post('/api/uploads', { bodyLimit: MAX_IMAGE_BYTES }, async (request, reply) => {
    const { machineId, name } = z.object({ machineId: opaqueId, name: z.string().max(255).optional() }).strict().parse(request.query);
    const supervisor = manager.supervisors.get(machineId);
    if (!supervisor?.connected) return reply.code(409).send({ error: 'machine_disconnected' });
    if (!supervisor.target.acceptsLocalFiles) return reply.code(409).send({ error: 'uploads_unsupported_target' });
    if (!Buffer.isBuffer(request.body)) return reply.code(415).send({ error: 'unsupported_image' });
    const contentType = request.headers['content-type'];
    return { path: isFileUpload(contentType) ? await uploads.saveFile(name, request.body) : await uploads.save(contentType, request.body) };
  });
  app.get('/api/directories', async (request, reply) => {
    const { machineId, prefix } = z.object({ machineId: opaqueId, prefix: z.string().max(1000).refine((path) => !/[\x00-\x1f]/.test(path)) }).strict().parse(request.query);
    const supervisor = manager.supervisors.get(machineId);
    if (!supervisor?.connected || !supervisor.target.suggestDirectories) return reply.code(409).send({ error: 'directories_unsupported_target' });
    return supervisor.target.suggestDirectories(prefix);
  });
  app.get('/api/worktrees', async (request) => {
    const { machineId, projectId } = z.object({ machineId: opaqueId, projectId: opaqueId }).strict().parse(request.query);
    return manager.worktrees(machineId, projectId);
  });
  app.post('/api/worktrees/open', async (request) => {
    const input = z.object({ machineId: opaqueId, projectId: opaqueId, path: z.string().min(1).max(1000) }).strict().parse(request.body);
    return manager.openWorktree(input.machineId, input.projectId, input.path);
  });
  app.post('/api/workspaces', async (request, reply) => {
    const input = z.object({ machineId: opaqueId, path: z.string().regex(/^(\/|~\/)/).max(1000).refine((path) => !/[\x00-\x1f]/.test(path)), label: z.string().trim().min(1).max(80) }).strict().parse(request.body);
    const key = z.uuid().parse(request.headers['idempotency-key']);
    const supervisor = manager.supervisors.get(input.machineId);
    if (!supervisor?.connected) return reply.code(409).send({ error: 'machine_disconnected' });
    const result = await createWorkspace(manager.database, supervisor.target, key, input.path, input.label);
    supervisor.invalidate();
    return reply.code(result.state === 'unknown' ? 202 : 201).send(result);
  });
  const projectIconTarget = z.object({ machineId: opaqueId, logicalId: z.string().min(1).max(1000) }).strict();
  app.put('/api/projects/icon', { bodyLimit: MAX_PROJECT_ICON_BYTES }, async (request, reply) => {
    const { machineId, logicalId } = projectIconTarget.parse(request.query);
    if (!Buffer.isBuffer(request.body)) return reply.code(415).send({ error: 'unsupported_image' });
    manager.setProjectIcon(machineId, logicalId, request.headers['content-type'], request.body); return { saved: true };
  });
  app.delete('/api/projects/icon', async (request) => {
    const { machineId, logicalId } = projectIconTarget.parse(request.query);
    manager.resetProjectIcon(machineId, logicalId); return { reset: true };
  });
  app.get('/api/projects/:machineId/:projectId/icon', async (request, reply) => {
    const { machineId, projectId } = z.object({ machineId: opaqueId, projectId: opaqueId }).parse(request.params);
    const target = manager.supervisors.get(machineId)?.target;
    const icon = manager.customProjectIcon(machineId, projectId) ?? await target?.icon?.(projectId);
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
    if (!catalog.harnesses.find((harness) => harness.id === input.agent)?.launchEnabled || supervisor.target.canLaunch && !supervisor.target.canLaunch(input)) return reply.code(409).send({ error: 'launch_unavailable' });
    const result = manager.journal.submit(localOwner, key, input, supervisor.target);
    return reply.code(202).send(result);
  });
  app.post('/api/threads/:id/adopt', async (request) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const input = z.object({ machineId: opaqueId, terminalIds: z.array(opaqueId).min(1).max(256) }).strict().parse(request.body);
    await manager.adopt(input.machineId, id, input.terminalIds); return { adopted: true };
  });
  app.post('/api/threads/:id/focus', async (request) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const input = z.object({ machineId: opaqueId, paneId: opaqueId }).strict().parse(request.body);
    await manager.focusPane(input.machineId, id, input.paneId); return { focused: true };
  });
  app.post('/api/threads/:id/archive', async (request) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const input = z.object({ machineId: opaqueId, archived: z.boolean() }).strict().parse(request.body);
    manager.archive(input.machineId, id, input.archived); return { archived: input.archived };
  });
  app.post('/api/projects/rename', async (request) => {
    const input = z.object({ machineId: opaqueId, logicalId: z.string().min(1).max(1000), name: z.string().trim().min(1).max(90).refine((name) => !/[\x00-\x1f\x7f]/.test(name)) }).strict().parse(request.body);
    manager.renameProject(input.machineId, input.logicalId, input.name); return { name: input.name };
  });
  app.post('/api/threads/:id/rename', async (request) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const input = z.object({ machineId: opaqueId, title: z.string().trim().min(1).max(90).refine((title) => !/[\x00-\x1f\x7f]/.test(title)) }).strict().parse(request.body);
    await manager.renameThread(input.machineId, id, input.title); return { title: input.title };
  });
  app.post('/api/threads/:id/panes/terminal', async (request) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const input = z.object({ machineId: opaqueId, afterPaneId: opaqueId }).strict().parse(request.body);
    return manager.openTerminal(input.machineId, id, input.afterPaneId);
  });
  app.post('/api/threads/:id/panes/close', async (request) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const input = z.object({ machineId: opaqueId, paneId: opaqueId, force: z.boolean() }).strict().parse(request.body);
    return manager.closePane(input.machineId, id, input.paneId, input.force);
  });
  app.post('/api/threads/:id/delete', async (request) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const input = z.object({ machineId: opaqueId }).strict().parse(request.body);
    await manager.deleteThread(input.machineId, id); return { deleted: true };
  });
  app.post('/api/archive/delete', async () => manager.deleteArchived());
  app.get('/api/operations/:id', async (request, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const operation = manager.database.operation(id);
    if (!operation || ![localOwner, manager.database.getSetting('allowed_account')].includes(operation.accountId)) return reply.code(404).send({ error: 'operation_not_found' });
    return { id: operation.id, state: operation.state, step: operation.step, threadId: operation.threadId };
  });
  app.get('/api/stats', async () => hub.stats());
  if (perfLogEnabled) app.post('/api/dev/perf', { bodyLimit: 256 * 1024 }, async (request) => { for (const record of z.object({ records: z.array(z.record(z.string(), z.unknown())).max(100) }).parse(request.body).records) perfLog('client', record); return { ok: true }; });
  if (ssr) {
    const clientRoot = resolve(distRoot(), 'client');
    await app.register(staticFiles, { root: clientRoot, serve: false });
    app.get('/_astro/*', async (request, reply) => {
      const path = z.string().regex(/^[A-Za-z0-9_./-]+$/).parse((request.params as { '*': string })['*']);
      const full = resolve(clientRoot, '_astro', path);
      if (!full.startsWith(resolve(clientRoot, '_astro') + '/')) return reply.code(404).send();
      return reply.sendFile(path, resolve(clientRoot, '_astro'));
    });
    app.get('/:file(^[a-z0-9-]+\\.(?:png|ico|webmanifest)$)', async (request, reply) => reply.sendFile((request.params as { file: string }).file, clientRoot));
    app.get('/*', async (request, reply) => {
      reply.hijack();
      if (perfLogEnabled) reply.raw.setHeader('Document-Policy', 'js-profiling');
      ssr(request.raw, reply.raw, () => { if (!reply.raw.headersSent) { reply.raw.statusCode = 404; reply.raw.end('Not found'); } }, { runtime: manager, accountId: localOwner });
    });
  }
  app.addHook('onClose', async () => { transcriber?.close(); return manager.close(); });
  return app;
}
