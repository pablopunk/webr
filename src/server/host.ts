import Fastify, { type FastifyRequest } from 'fastify';
import websocket from '@fastify/websocket';
import staticFiles from '@fastify/static';
import { resolve } from 'node:path';
import { cpus, freemem, totalmem } from 'node:os';
import { distRoot } from './dist';
import { z } from 'zod';
import type { RuntimeManager } from './runtime/manager';
import { createOperationEnvelope } from './runtime/workspace';
import { launchInput, opaqueId, terminalCreateInput, worktreeOpenInput, workspaceCreateInput } from '../shared/runtime';
import { registerWebsockets } from './websockets';
import { loadHerdrKeymap } from './herdr-keys';
import { traceLog } from './trace-log';
import { perfLog, perfLogEnabled } from './perf-log';
import { Auth, type AuthOptions } from './auth/auth';
import { isTrustedHost } from './auth/access';
import { registerDevHmrProxy } from './dev-hmr-proxy';
import { registerVoiceRoutes } from './voice/routes';
import type { Transcriber } from './voice/transcriber';
import type { Updates } from '../shared/update';
import { MAX_IMAGE_BYTES, UploadStore, uploadContentTypes, uploadFileName } from './uploads';

const localOwner = 'local';
function launchOwner(auth: Auth, request: FastifyRequest, database: RuntimeManager['database']) {
  const access = auth.access(request);
  return access.local || !access.session ? localOwner : database.getSetting('allowed_account') ?? localOwner;
}
function createOperationOwner(auth: Auth, request: FastifyRequest, database: RuntimeManager['database']) {
  const access = auth.access(request);
  if (access.local || !access.session) return localOwner;
  return database.getSetting('allowed_account') ?? `device:${access.session.id}`;
}
type SsrHandler = (request: FastifyRequest['raw'], response: import('node:http').ServerResponse, next: (error?: unknown) => void, locals: Record<string, unknown>) => void;

const MAX_PROJECT_ICON_BYTES = 512 * 1024;

export async function createHost(manager: RuntimeManager, origin: string, ssr?: SsrHandler, tls?: { key: Buffer; cert: Buffer }, uploads = new UploadStore(), authOptions: AuthOptions = {}, { devHmrPort, transcriber, updates }: { devHmrPort?: number; transcriber?: Transcriber; updates?: Updates } = {}) {
  const app = Fastify({ logger: false, bodyLimit: 16 * 1024, ...(tls ? { https: tls } : {}), requestTimeout: 10_000 });
  const configuredOrigin = new URL(origin);
  const auth = new Auth(manager.database, configuredOrigin, authOptions);
  let previousCpu = cpus().reduce((total, cpu) => ({ idle: total.idle + cpu.times.idle, total: total.total + Object.values(cpu.times).reduce((sum, time) => sum + time, 0) }), { idle: 0, total: 0 });
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
    if (message === 'upload_failed') return reply.code(502).send({ error: message });
    if (status === 415 || message === 'unsupported_image') return reply.code(415).send({ error: 'unsupported_image' });
    if (status && status >= 400 && status < 500) return reply.code(status).send({ error: 'invalid_request' });
    if (message === 'thread_not_found' || message === 'tab_not_found') return reply.code(404).send({ error: message });
    if (message === 'read_only') return reply.code(403).send({ error: message });
    if (message === 'launch_in_progress') return reply.code(409).send({ error: message });
    if (message === 'launch_capacity_exceeded') return reply.code(429).send({ error: message });
    if (message === 'pane_outcome_unknown') return reply.code(503).send({ error: message });
    if (message === 'pane_action_unavailable' || message === 'pane_action_refused') return reply.code(409).send({ error: message });
    const conflict = ['idempotency_conflict', 'binding_conflict', 'invalid_adoption', 'machine_disconnected', 'workspace_creation_unavailable', 'legacy_operation_ownership_ambiguous', 'legacy_operation_kind_ambiguous'].includes(message);
    return reply.code(conflict ? 409 : 503).send({ error: conflict ? message : 'request_failed' });
  });
  await app.register(websocket, { options: { maxPayload: 32 * 1024, perMessageDeflate: false } });
  const hub = registerWebsockets(app, manager);
  auth.routes(app);
  if (devHmrPort) registerDevHmrProxy(app, devHmrPort);
  if (transcriber) registerVoiceRoutes(app, transcriber);
  if (updates) {
    app.get('/api/update', async () => updates.status());
    app.post('/api/update/check', async () => updates.check());
    app.post('/api/restart', async (_request, reply) => reply.code(202).send(updates.restart()));
    app.post('/api/update', async (_request, reply) => { const status = updates.start(); return reply.code(status.state === 'updating' ? 202 : 409).send(status); });
  }
  app.get('/api/catalog/machines', async () => manager.bootstrap().machines);
  app.get('/api/catalog/:machineId', async (request) => {
    const { machineId } = z.object({ machineId: opaqueId }).parse(request.params);
    const { projectId } = z.object({ projectId: opaqueId.optional() }).strict().parse(request.query);
    return manager.catalog(machineId, projectId);
  });
  app.get('/api/runtime', async (request) => manager.bootstrap(launchOwner(auth, request, manager.database), createOperationOwner(auth, request, manager.database)));
  app.get('/api/herdr-keys', async () => loadHerdrKeymap());
  app.get('/api/metrics', async () => {
    const cores = cpus();
    const currentCpu = cores.reduce((total, cpu) => ({ idle: total.idle + cpu.times.idle, total: total.total + Object.values(cpu.times).reduce((sum, time) => sum + time, 0) }), { idle: 0, total: 0 });
    const idle = currentCpu.idle - previousCpu.idle;
    const elapsed = currentCpu.total - previousCpu.total;
    previousCpu = currentCpu;
    const memoryTotalBytes = totalmem();
    const memoryUsedBytes = memoryTotalBytes - freemem();
    return { cpu: elapsed > 0 ? Math.round(Math.max(0, Math.min(100, (1 - idle / elapsed) * 100))) : 0, cpuCores: cores.length, memory: memoryTotalBytes > 0 ? Math.round(memoryUsedBytes / memoryTotalBytes * 100) : 0, memoryUsedBytes, memoryTotalBytes };
  });
  app.addContentTypeParser(uploadContentTypes, { parseAs: 'buffer', bodyLimit: MAX_IMAGE_BYTES }, (_request, body, done) => done(null, body));
  app.post('/api/uploads', { bodyLimit: MAX_IMAGE_BYTES }, async (request, reply) => {
    const { machineId, name } = z.object({ machineId: opaqueId, name: z.string().max(255).optional() }).strict().parse(request.query);
    const supervisor = manager.supervisors.get(machineId);
    if (!supervisor?.connected) return reply.code(409).send({ error: 'machine_disconnected' });
    if (!supervisor.target.acceptsUploads) return reply.code(409).send({ error: 'uploads_unsupported_target' });
    if (!Buffer.isBuffer(request.body)) return reply.code(415).send({ error: 'unsupported_image' });
    const fileName = uploadFileName(request.headers['content-type'], name, request.body);
    return { path: supervisor.target.storeUpload ? await supervisor.target.storeUpload(fileName, request.body) : await uploads.saveAs(fileName, request.body) };
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
  app.post('/api/worktrees/open', async (request, reply) => {
    const input = worktreeOpenInput.parse(request.body);
    const key = z.uuid().parse(request.headers['idempotency-key']);
    const owner = createOperationOwner(auth, request, manager.database);
    const accepted = manager.acceptCreateOperation(owner, 'worktree', key, input);
    if (accepted.envelope.state === 'pending') reply.raw.once('finish', () => manager.startCreateOperation(accepted.envelope.operationId));
    return reply.code(202).send(accepted.envelope);
  });
  app.post('/api/workspaces', async (request, reply) => {
    const input = workspaceCreateInput.parse(request.body);
    const key = z.uuid().parse(request.headers['idempotency-key']);
    const owner = createOperationOwner(auth, request, manager.database);
    const accepted = manager.acceptCreateOperation(owner, 'workspace', key, input);
    if (accepted.envelope.state === 'pending') reply.raw.once('finish', () => manager.startCreateOperation(accepted.envelope.operationId));
    return reply.code(202).send(accepted.envelope);
  });
  app.post('/api/terminals', async (request, reply) => {
    const input = terminalCreateInput.parse(request.body);
    const key = z.uuid().parse(request.headers['idempotency-key']);
    const owner = createOperationOwner(auth, request, manager.database);
    const accepted = manager.acceptCreateOperation(owner, 'terminal', key, input);
    if (accepted.envelope.state === 'pending') reply.raw.once('finish', () => manager.startCreateOperation(accepted.envelope.operationId));
    return reply.code(202).send(accepted.envelope);
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
  const candidateParams = z.object({ machineId: opaqueId, projectId: opaqueId });
  app.get('/api/projects/:machineId/:projectId/icon-candidates', async (request) => {
    const { machineId, projectId } = candidateParams.parse(request.params);
    const found = await manager.supervisors.get(machineId)?.target.iconCandidates?.(projectId) ?? [];
    return found.map((candidate, index) => ({ name: candidate.name, url: `/api/projects/${encodeURIComponent(machineId)}/${encodeURIComponent(projectId)}/icon-candidates/${index}` }));
  });
  app.get('/api/projects/:machineId/:projectId/icon-candidates/:index', async (request, reply) => {
    const { machineId, projectId, index } = candidateParams.extend({ index: z.coerce.number().int().min(0).max(99) }).parse(request.params);
    const candidate = (await manager.supervisors.get(machineId)?.target.iconCandidates?.(projectId))?.[index];
    if (!candidate) return reply.code(404).send();
    const bytes = await candidate.load().catch(() => undefined);
    if (!bytes) return reply.code(404).send();
    if (candidate.contentType === 'image/svg+xml') reply.header('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'");
    return reply.type(candidate.contentType).send(bytes);
  });
  app.post('/api/threads', async (request, reply) => {
    const input = launchInput.parse(request.body);
    const key = z.uuid().parse(request.headers['idempotency-key']);
    const owner = launchOwner(auth, request, manager.database);
    const previous = manager.journal.lookup(owner, key, input);
    if (previous) return reply.code(202).send(previous);
    const supervisor = manager.supervisors.get(input.machineId);
    if (!supervisor?.connected) return reply.code(409).send({ error: 'machine_disconnected' });
    const target = supervisor.target;
    if (!target.locations.some((location) => location.projectId === input.projectId)) return reply.code(404).send({ error: 'launch_unavailable' });
    const identity = { fingerprint: target.fingerprint, session: target.session, configVersion: target.configVersion };
    if (!manager.isLaunchTargetCurrent(target, identity)) return reply.code(409).send({ error: 'machine_disconnected' });
    if (target.enabled === false || target.canLaunch && !target.canLaunch(input)) return reply.code(409).send({ error: 'launch_unavailable' });
    const result = manager.journal.submit(owner, key, input, target, (candidate, captured) => manager.isLaunchTargetCurrent(candidate, captured));
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
    return manager.focusPane(input.machineId, id, input.paneId);
  });
  app.post('/api/threads/:id/archive', async (request) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const input = z.object({ machineId: opaqueId, archived: z.boolean() }).strict().parse(request.body);
    return manager.archive(input.machineId, id, input.archived);
  });
  app.post('/api/projects/rename', async (request) => {
    const input = z.object({ machineId: opaqueId, logicalId: z.string().min(1).max(1000), name: z.string().trim().min(1).max(90).refine((name) => !/[\x00-\x1f\x7f]/.test(name)) }).strict().parse(request.body);
    return manager.renameProject(input.machineId, input.logicalId, input.name);
  });
  app.post('/api/threads/:id/rename', async (request) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const input = z.object({ machineId: opaqueId, title: z.union([z.string().trim().min(1).max(90).refine((title) => !/[\x00-\x1f\x7f]/.test(title)), z.null()]) }).strict().parse(request.body);
    return manager.renameThread(input.machineId, id, input.title);
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
  app.post('/api/tabs/close', async (request) => {
    const input = z.object({ machineId: opaqueId, tabId: opaqueId, force: z.boolean() }).strict().parse(request.body);
    return manager.closeTab(input.machineId, input.tabId, input.force);
  });
  app.post('/api/archive/delete', async () => manager.deleteArchived());
  app.get('/api/operations/:id', async (request, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const visibleOwners = [localOwner, manager.database.getSetting('allowed_account'), createOperationOwner(auth, request, manager.database)];
    const operation = manager.database.operation(id);
    if (operation) {
      if (!visibleOwners.includes(operation.accountId)) return reply.code(404).send({ error: 'operation_not_found' });
      return manager.journal.envelope(operation);
    }
    const createOperation = manager.database.createOperation(id);
    if (!createOperation || !visibleOwners.includes(createOperation.accountId)) return reply.code(404).send({ error: 'operation_not_found' });
    return createOperationEnvelope(createOperation);
  });
  app.get('/api/stats', async () => hub.stats());
  app.post('/api/trace', { bodyLimit: 256 * 1024 }, async (request) => { await traceLog(z.object({ records: z.array(z.record(z.string(), z.unknown())).max(300) }).parse(request.body).records); return { ok: true }; });
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
    app.get('/harness-icons/:file(^[a-z0-9-]+\\.png$)', async (request, reply) => {
      const { file } = z.object({ file: z.string() }).parse(request.params);
      return reply.sendFile(file, resolve(clientRoot, 'harness-icons'));
    });
    app.get('/*', async (request, reply) => {
      reply.hijack();
      if (perfLogEnabled) reply.raw.setHeader('Document-Policy', 'js-profiling');
      const owner = launchOwner(auth, request, manager.database);
      const resourceOwner = createOperationOwner(auth, request, manager.database);
      ssr(request.raw, reply.raw, () => { if (!reply.raw.headersSent) { reply.raw.statusCode = 404; reply.raw.end('Not found'); } }, { runtime: manager, accountId: owner, resourceAccountId: resourceOwner });
    });
  }
  app.addHook('onClose', async () => { transcriber?.close(); return manager.close(); });
  return app;
}
