import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createRuntimeStore, metadataFieldKey, threadStateKey } from '../../src/client/store';
import { createPendingMetadataController, threadDisplayTitle, threadIsArchived } from '../../src/client/pending-metadata';
import { ThreadTitleEditor } from '../../src/components/ThreadTitleEditor';
import { ProjectNameEditor } from '../../src/components/ProjectNameEditor';
import { ThreadView } from '../../src/components/ThreadView';
import App from '../../src/components/App';
import { LaunchProgress } from '../../src/components/LaunchProgress';
import { Sidebar } from '../../src/components/Sidebar';
import type { Bootstrap, Projection, ProjectRenameResponse, ThreadArchiveResponse, ThreadRenameResponse } from '../../src/shared/runtime';
import { exampleThreads, type Project, type Thread } from '../../src/lib/models';

vi.mock('astro:transitions/client', () => ({ navigate: vi.fn() }));
vi.mock('../../src/client/terminal-manager', () => ({ BrowserTerminalManager: class { start() {} stop() {} } }));
vi.mock('../../src/components/PairingPrompt', () => ({ PairingPrompt: () => null }));
vi.mock('../../src/components/UpdateButton', () => ({ UpdateButton: () => null }));
vi.mock('../../src/components/SidebarMetrics', () => ({ SidebarMetrics: () => null }));
vi.mock('../../src/components/TerminalPane', () => ({ TerminalPane: () => null }));
vi.mock('../../src/components/PerfOverlay', () => ({ PerfOverlay: () => null }));
vi.mock('../../src/client/perf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/perf')>();
  return { ...actual, perfAvailable: false, startPerf: () => () => {} };
});
vi.mock('../../src/components/shortcuts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/components/shortcuts')>();
  return { ...actual, loadShortcuts: () => Promise.resolve(actual.getShortcuts()) };
});
vi.mock('../../src/components/dialogs', () => ({ confirmDialog: vi.fn(async () => true), alertDialog: vi.fn(async () => undefined) }));

const baseThread = (): Thread => ({ ...exampleThreads()[0], id: 'thread-one', machineId: 'machine-a', title: 'Native title', titleOverride: undefined, archivedAt: undefined, metadataVersion: 1, titleSync: { version: 1, state: 'unknown' }, status: 'idle', prompt: '', panes: [] });
const baseProject = (): Project => ({ id: 'project-one', logicalId: 'shared-project', machineId: 'machine-a', name: 'Original project', path: '/project', color: '#456', initial: 'P', metadataVersion: 1 });
const machine = { id: 'machine-a', name: 'Machine A', connected: true, session: 'default', projectPaths: {}, harnesses: [], writable: true };
const projection = (thread: Thread = baseThread(), project: Project = baseProject(), revision = 1): Projection => ({ machineId: 'machine-a', generation: 'generation-a', revision, freshAt: null, connected: true, threads: [thread], projects: [project], layouts: [] });
const bootstrap = (thread = baseThread(), project = baseProject(), revision = 1, recoveryScope = 'scope-a'): Bootstrap => ({ projections: [projection(thread, project, revision)], machines: [machine], threads: [thread], projects: [project], recoveryScope });
const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const threadAck = (thread: Thread, titleOverride: string | null, metadataVersion: number, archivedAt: string | null = null): ThreadRenameResponse => ({ entityId: thread.id, metadataVersion, metadata: { titleOverride, archivedAt }, title: titleOverride ?? thread.title });
const archiveAck = (thread: Thread, archived: boolean, metadataVersion: number, archivedAt: string | null): ThreadArchiveResponse => ({ entityId: thread.id, metadataVersion, metadata: { titleOverride: thread.titleOverride ?? null, archivedAt }, archived });
const projectAck = (project: Project, name: string, metadataVersion: number): ProjectRenameResponse => ({ machineId: project.machineId!, entityId: project.logicalId!, metadataVersion, metadata: { name }, name });
const controllers: ReturnType<typeof createPendingMetadataController>[] = [];
function setup(thread = baseThread(), project = baseProject()) {
  const runtime = createRuntimeStore(bootstrap(thread, project));
  const metadata = createPendingMetadataController(runtime, 'scope-a');
  controllers.push(metadata);
  return { runtime, metadata, thread, project };
}
afterEach(() => { cleanup(); for (const controller of controllers.splice(0)) controller.dispose(); vi.unstubAllGlobals(); vi.useRealTimers(); localStorage.clear(); window.history.replaceState(null, '', '/'); });

it('renders thread title and project-name intents immediately without changing confirmed projections', async () => {
  const { runtime, metadata, thread, project } = setup();
  const heldTitle = deferred<Response>(); const heldProject = deferred<Response>();
  const fetchMock = vi.fn((path: string) => path === '/api/projects/rename' ? heldProject.promise : heldTitle.promise);
  vi.stubGlobal('fetch', fetchMock);
  const titleSave = metadata.renameThread(thread, 'Instant title').catch(() => undefined);
  expect(runtime.getState().threads[threadStateKey(thread.machineId, thread.id)]).toMatchObject({ title: 'Native title', titleOverride: 'Instant title' });
  expect(runtime.getState().confirmedThreads[threadStateKey(thread.machineId, thread.id)]).toMatchObject({ title: 'Native title', titleOverride: undefined });
  const projectSave = metadata.renameProject(project, 'Instant project').catch(() => undefined);
  expect(runtime.getState().projects[JSON.stringify([project.machineId, project.logicalId])].name).toBe('Instant project');
  expect(runtime.getState().confirmedProjects[JSON.stringify([project.machineId, project.logicalId])].name).toBe('Original project');
  expect(fetchMock).toHaveBeenCalledTimes(2);
  heldTitle.resolve(response(threadAck(thread, 'Canonical title', 2)));
  heldProject.resolve(response(projectAck(project, 'Canonical project', 2)));
  await Promise.all([titleSave, projectSave]);
  expect(runtime.getState().threads[threadStateKey(thread.machineId, thread.id)].titleOverride).toBe('Canonical title');
  expect(runtime.getState().projects[JSON.stringify([project.machineId, project.logicalId])].name).toBe('Canonical project');
  expect(runtime.getState().confirmedThreads[threadStateKey(thread.machineId, thread.id)].titleOverride).toBeUndefined();
  expect(runtime.getState().confirmedProjects[JSON.stringify([project.machineId, project.logicalId])].name).toBe('Original project');
});

it('uses only a pending archive boolean for list membership and never invents archivedAt', async () => {
  const { runtime, metadata, thread } = setup();
  const held = deferred<Response>();
  vi.stubGlobal('fetch', vi.fn(() => held.promise));
  void metadata.setThreadArchived(thread, true).catch(() => undefined);
  const state = runtime.getState();
  const key = threadStateKey(thread.machineId, thread.id);
  expect(threadIsArchived(state.threads[key], state.metadataFields)).toBe(true);
  expect(state.threads[key].archivedAt).toBeUndefined();
  expect(state.confirmedThreads[key].archivedAt).toBeUndefined();
  held.resolve(response(archiveAck(thread, true, 2, 'server-canonical-time')));
  await waitFor(() => expect(runtime.getState().metadataFields[metadataFieldKey('thread', thread.machineId, thread.id, 'archived')].status).toBe('saved'));
  expect(runtime.getState().threads[key].archivedAt).toBe('server-canonical-time');
  expect(runtime.getState().confirmedThreads[key].archivedAt).toBeUndefined();
});

it('serializes each entity field while unrelated fields proceed and keeps the newest same-field intent visible', async () => {
  const { runtime, metadata, thread } = setup();
  const calls: { path: string; body: Record<string, unknown>; held: ReturnType<typeof deferred<Response>> }[] = [];
  vi.stubGlobal('fetch', vi.fn((path: string, init: RequestInit) => {
    const held = deferred<Response>();
    calls.push({ path, body: JSON.parse(String(init.body)) as Record<string, unknown>, held });
    return held.promise;
  }));
  const first = metadata.renameThread(thread, 'first').catch(() => undefined);
  const second = metadata.renameThread(thread, 'second').catch(() => undefined);
  const archive = metadata.setThreadArchived(thread, true).catch(() => undefined);
  expect(calls).toHaveLength(2);
  expect(runtime.getState().threads[threadStateKey(thread.machineId, thread.id)].titleOverride).toBe('second');
  calls[1].held.resolve(response(archiveAck(thread, true, 2, 'server-archive-time')));
  calls[0].held.resolve(response(threadAck(thread, 'first', 3, 'server-archive-time')));
  await Promise.all([first, archive]);
  await waitFor(() => expect(calls).toHaveLength(3));
  expect(calls[2].body).toEqual({ machineId: thread.machineId, title: 'second' });
  calls[2].held.resolve(response(threadAck(thread, 'second', 4, 'server-archive-time')));
  await second;
  const state = runtime.getState();
  expect(state.threads[threadStateKey(thread.machineId, thread.id)].titleOverride).toBe('second');
  expect(state.confirmedThreads[threadStateKey(thread.machineId, thread.id)].titleOverride).toBeUndefined();
});

it('lets a newer intent survive an older definitive rejection and then sends it', async () => {
  const { runtime, metadata, thread } = setup();
  const calls: ReturnType<typeof deferred<Response>>[] = [];
  vi.stubGlobal('fetch', vi.fn(() => { const next = deferred<Response>(); calls.push(next); return next.promise; }));
  const first = metadata.renameThread(thread, 'rejected').catch((error) => error);
  const second = metadata.renameThread(thread, 'survivor').catch(() => undefined);
  expect(runtime.getState().threads[threadStateKey(thread.machineId, thread.id)].titleOverride).toBe('survivor');
  calls[0].resolve(response({ error: 'invalid_request' }, 400));
  expect(await first).toBeInstanceOf(Error);
  await waitFor(() => expect(calls).toHaveLength(2));
  expect(runtime.getState().threads[threadStateKey(thread.machineId, thread.id)].titleOverride).toBe('survivor');
  calls[1].resolve(response(threadAck(thread, 'survivor', 2)));
  await second;
});

it('retires an acknowledged intent after a matching projection regardless of arrival order', async () => {
  const { runtime, metadata, thread, project } = setup();
  const held = deferred<Response>();
  vi.stubGlobal('fetch', vi.fn(() => held.promise));
  const save = metadata.renameThread(thread, 'canonical').catch(() => undefined);
  const projected = { ...thread, titleOverride: 'canonical', metadataVersion: 2 };
  act(() => { runtime.getState().install(projection(projected, project, 2)); });
  expect(runtime.getState().metadataFields[metadataFieldKey('thread', thread.machineId, thread.id, 'titleOverride')].hasOverlay).toBe(true);
  held.resolve(response(threadAck(thread, 'canonical', 2)));
  await save;
  await waitFor(() => expect(runtime.getState().metadataFields[metadataFieldKey('thread', thread.machineId, thread.id, 'titleOverride')].hasOverlay).toBe(false));
  expect(runtime.getState().threads[threadStateKey(thread.machineId, thread.id)].title).toBe('Native title');
});

it('keeps an acknowledged overlay until the projection catches up, and lets a later version supersede it', async () => {
  const { runtime, metadata, thread, project } = setup();
  const held = deferred<Response>();
  vi.stubGlobal('fetch', vi.fn(() => held.promise));
  const save = metadata.renameThread(thread, 'acknowledged').catch(() => undefined);
  held.resolve(response(threadAck(thread, 'acknowledged', 2)));
  await save;
  expect(runtime.getState().metadataFields[metadataFieldKey('thread', thread.machineId, thread.id, 'titleOverride')].hasOverlay).toBe(true);
  act(() => { runtime.getState().install(projection({ ...thread, titleOverride: 'server later write', metadataVersion: 3 }, project, 2)); });
  expect(runtime.getState().threads[threadStateKey(thread.machineId, thread.id)].titleOverride).toBe('server later write');
  expect(runtime.getState().metadataFields[metadataFieldKey('thread', thread.machineId, thread.id, 'titleOverride')].hasOverlay).toBe(false);
});

it('pauses on an exact-version acknowledgement mismatch, then resumes queued edits after a later version', async () => {
  const { runtime, metadata, thread, project } = setup();
  const held = deferred<Response>();
  const next = deferred<Response>();
  const fetchMock = vi.fn().mockImplementationOnce(() => held.promise).mockImplementationOnce(() => next.promise);
  vi.stubGlobal('fetch', fetchMock);
  const save = metadata.renameThread(thread, 'expected').catch(() => undefined);
  const queuedSave = metadata.renameThread(thread, 'queued value').catch(() => undefined);
  act(() => { runtime.getState().install(projection({ ...thread, titleOverride: 'different', metadataVersion: 2 }, project, 2)); });
  held.resolve(response(threadAck(thread, 'expected', 2)));
  await save;
  const field = runtime.getState().metadataFields[metadataFieldKey('thread', thread.machineId, thread.id, 'titleOverride')];
  expect(field).toMatchObject({ status: 'uncertain', hasOverlay: true });
  expect(field.message).toMatch(/disagrees with its acknowledgement/);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  act(() => { runtime.getState().install(projection({ ...thread, titleOverride: 'later writer', metadataVersion: 3 }, project, 3)); });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(runtime.getState().threads[threadStateKey(thread.machineId, thread.id)].titleOverride).toBe('queued value');
  next.resolve(response(threadAck(thread, 'queued value', 4)));
  await queuedSave;
});

it('accepts a no-op archive acknowledgement at the same version using only the server timestamp', async () => {
  for (const archived of [true, false]) {
    const timestamp = archived ? 'canonical-archive-time' : null;
    const thread = { ...baseThread(), metadataVersion: 8, archivedAt: timestamp ?? undefined };
    const { runtime, metadata } = setup(thread);
    vi.stubGlobal('fetch', vi.fn(async () => response(archiveAck(thread, archived, 8, timestamp))));
    const saving = metadata.setThreadArchived(thread, archived);
    await saving;
    const stored = runtime.getState().threads[threadStateKey(thread.machineId, thread.id)];
    expect(stored.archivedAt).toBe(timestamp ?? undefined);
    expect(runtime.getState().metadataFields[metadataFieldKey('thread', thread.machineId, thread.id, 'archived')].hasOverlay).toBe(false);
  }
});

const definitiveCases = [
  ['thread rename', 'rename', 400, 'invalid_request', true], ['thread rename', 'rename', 401, 'unauthorized', true], ['thread rename', 'rename', 403, 'invalid_host', true], ['thread rename', 'rename', 403, 'invalid_origin', true], ['thread rename', 'rename', 404, 'thread_not_found', true],
  ['thread archive', 'archive', 400, 'invalid_request', true], ['thread archive', 'archive', 401, 'unauthorized', true], ['thread archive', 'archive', 403, 'invalid_host', true], ['thread archive', 'archive', 403, 'invalid_origin', true], ['thread archive', 'archive', 404, 'thread_not_found', true],
  ['project rename', 'project', 400, 'invalid_request', true], ['project rename', 'project', 401, 'unauthorized', true], ['project rename', 'project', 403, 'invalid_host', true], ['project rename', 'project', 403, 'invalid_origin', true], ['project rename', 'project', 409, 'machine_disconnected', true],
  ['project rename rejects thread-only 404', 'project', 404, 'thread_not_found', false], ['thread rename rejects project-only 409', 'rename', 409, 'machine_disconnected', false],
  ['generic 503 is uncertain', 'rename', 503, 'request_failed', false], ['unknown 500 is uncertain', 'project', 500, 'request_failed', false],
] as const;
it.each(definitiveCases)('%s (%s, %i, %s) classification', async (_label, kind, status, error, expectedDefinitive) => {
  const { runtime, metadata, thread, project } = setup();
  vi.stubGlobal('fetch', vi.fn(async () => response({ error }, status)));
  const pending = kind === 'project' ? metadata.renameProject(project, 'Changed') : kind === 'archive' ? metadata.setThreadArchived(thread, true) : metadata.renameThread(thread, 'Changed');
  await expect(pending).rejects.toBeInstanceOf(Error);
  const key = kind === 'project' ? metadataFieldKey('project', project.machineId!, project.logicalId!, 'name') : kind === 'archive' ? metadataFieldKey('thread', thread.machineId, thread.id, 'archived') : metadataFieldKey('thread', thread.machineId, thread.id, 'titleOverride');
  expect(runtime.getState().metadataFields[key].status).toBe(expectedDefinitive ? 'failed' : 'uncertain');
  expect(runtime.getState().metadataFields[key].hasOverlay).toBe(!expectedDefinitive);
});

it('treats malformed 2xx responses and mismatched acknowledgements as uncertain', async () => {
  for (const responseBody of [{}, { entityId: 'wrong-id', metadataVersion: 2, metadata: { titleOverride: 'X', archivedAt: null }, title: 'X' }]) {
    const { runtime, metadata, thread } = setup();
    vi.stubGlobal('fetch', vi.fn(async () => response(responseBody)));
    await expect(metadata.renameThread(thread, 'X')).rejects.toBeInstanceOf(Error);
    expect(runtime.getState().metadataFields[metadataFieldKey('thread', thread.machineId, thread.id, 'titleOverride')].status).toBe('uncertain');
  }
  for (const acknowledgement of [
    (project: Project) => ({ ...projectAck(project, 'X', 2), machineId: 'another-machine' }),
    (project: Project) => ({ ...projectAck(project, 'X', 2), entityId: 'another-project' }),
  ]) {
    const { runtime, metadata, project } = setup();
    vi.stubGlobal('fetch', vi.fn(async () => response(acknowledgement(project))));
    await expect(metadata.renameProject(project, 'X')).rejects.toBeInstanceOf(Error);
    expect(runtime.getState().metadataFields[metadataFieldKey('project', project.machineId!, project.logicalId!, 'name')].status).toBe('uncertain');
  }
});

it('reconciles explicitly, keeps an editable draft, pauses queued sends, and requires explicit resave', async () => {
  const { runtime, metadata, thread, project } = setup();
  const refreshed = { ...thread, titleOverride: 'Server state', metadataVersion: 2 };
  const calls: { path: string; init?: RequestInit }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    if (init?.method === 'GET' || path === '/api/runtime') return response(bootstrap(refreshed, project, 2));
    if (calls.filter((call) => call.init?.method !== 'GET' && call.path !== '/api/runtime').length === 1) return response({ error: 'request_failed' }, 503);
    return response(threadAck(refreshed, 'Queued draft', 3));
  }));
  await expect(metadata.renameThread(thread, 'Uncertain value')).rejects.toBeInstanceOf(Error);
  const queued = metadata.renameThread(thread, 'Queued draft').catch(() => undefined);
  expect(calls).toHaveLength(1);
  await metadata.reconcileThread(thread, 'titleOverride');
  expect(calls.map((call) => call.path)).toEqual(['/api/threads/thread-one/rename', '/api/runtime']);
  const fieldKey = metadataFieldKey('thread', thread.machineId, thread.id, 'titleOverride');
  expect(runtime.getState().threads[threadStateKey(thread.machineId, thread.id)].titleOverride).toBe('Server state');
  expect(runtime.getState().metadataFields[fieldKey]).toMatchObject({ status: 'draft', hasOverlay: false, draftValue: 'Queued draft', requiresResaveConfirmation: true });
  await expect(metadata.renameThread(thread, 'Queued draft')).rejects.toThrow(/Explicitly confirm the re-save/);
  const resave = metadata.renameThread(thread, 'Queued draft', true);
  await resave;
  await queued;
  expect(calls.filter((call) => call.init?.method === 'POST')).toHaveLength(2);
});

it('keeps queued edits as drafts when reconciliation itself resolves an acknowledgement mismatch', async () => {
  const { runtime, metadata, thread, project } = setup();
  const original = deferred<Response>();
  const snapshot = deferred<Response>();
  const fetchMock = vi.fn((path: string) => path === '/api/runtime' ? snapshot.promise : original.promise);
  vi.stubGlobal('fetch', fetchMock);
  const firstSave = metadata.renameThread(thread, 'acknowledged value').catch(() => undefined);
  const queuedSave = metadata.renameThread(thread, 'queued draft').catch(() => undefined);
  act(() => { runtime.getState().install(projection({ ...thread, titleOverride: 'conflicting value', metadataVersion: 2 }, project, 2)); });
  original.resolve(response(threadAck(thread, 'acknowledged value', 2)));
  await firstSave;
  const reconciliation = metadata.reconcileThread(thread, 'titleOverride');
  act(() => { runtime.getState().install(projection({ ...thread, titleOverride: 'later server value', metadataVersion: 3 }, project, 3)); });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  snapshot.resolve(response(bootstrap({ ...thread, titleOverride: 'later server value', metadataVersion: 3 }, project, 3)));
  await reconciliation;
  await queuedSave;
  const field = runtime.getState().metadataFields[metadataFieldKey('thread', thread.machineId, thread.id, 'titleOverride')];
  expect(field).toMatchObject({ status: 'draft', hasOverlay: false, draftValue: 'queued draft' });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('installs reconciliation data after a freshness-only connection update', async () => {
  const { runtime, metadata, thread, project } = setup();
  act(() => { runtime.getState().install({ ...projection(thread, project, 1), freshAt: 'fresh-before-loss' }); });
  const heldSnapshot = deferred<Response>();
  vi.stubGlobal('fetch', vi.fn((path: string) => path === '/api/runtime' ? heldSnapshot.promise : Promise.resolve(response({ error: 'request_failed' }, 503))));
  await expect(metadata.renameThread(thread, 'Unknown value')).rejects.toBeInstanceOf(Error);
  const reconciliation = metadata.reconcileThread(thread, 'titleOverride');
  act(() => { runtime.getState().connection(false); });
  const refreshed = { ...thread, titleOverride: 'snapshot state', metadataVersion: 2 };
  heldSnapshot.resolve(response(bootstrap(refreshed, project, 2)));
  await reconciliation;
  expect(runtime.getState().confirmedThreads[threadStateKey(thread.machineId, thread.id)]).toMatchObject({ titleOverride: 'snapshot state', metadataVersion: 2 });
  expect(runtime.getState().threads[threadStateKey(thread.machineId, thread.id)].titleOverride).toBe('snapshot state');
});

it('keeps uncertainty when reconciliation has an empty generation or invalid revision', async () => {
  for (const invalidProjection of [
    { ...projection(), generation: '' },
    { ...projection(), revision: -1 },
  ]) {
    const { runtime, metadata, thread, project } = setup();
    const invalid = { ...bootstrap(thread, project, 2), projections: [invalidProjection] };
    vi.stubGlobal('fetch', vi.fn(async (path: string) => path === '/api/runtime' ? response(invalid) : response({ error: 'request_failed' }, 503)));
    await expect(metadata.renameThread(thread, 'Unknown value')).rejects.toBeInstanceOf(Error);
    await expect(metadata.reconcileThread(thread, 'titleOverride')).rejects.toThrow(/invalid projection versions/);
    expect(runtime.getState().confirmedThreads[threadStateKey(thread.machineId, thread.id)].titleOverride).toBeUndefined();
    expect(runtime.getState().metadataFields[metadataFieldKey('thread', thread.machineId, thread.id, 'titleOverride')].status).toBe('uncertain');
  }
});

it('keeps an archive draft editable without resubmitting it', async () => {
  const { runtime, metadata, thread, project } = setup();
  const fetchMock = vi.fn(async (path: string) => path === '/api/runtime' ? response(bootstrap(thread, project, 2)) : response({ error: 'request_failed' }, 503));
  vi.stubGlobal('fetch', fetchMock);
  await expect(metadata.setThreadArchived(thread, true)).rejects.toBeInstanceOf(Error);
  await metadata.reconcileThread(thread, 'archived');
  const key = metadataFieldKey('thread', thread.machineId, thread.id, 'archived');
  expect(runtime.getState().metadataFields[key]).toMatchObject({ status: 'draft', hasOverlay: false, draftValue: true });
  const requestsBeforeEdit = fetchMock.mock.calls.length;
  await metadata.updateThreadArchiveDraft(thread, false);
  expect(fetchMock).toHaveBeenCalledTimes(requestsBeforeEdit);
  expect(runtime.getState().metadataFields[key]).toMatchObject({ status: 'draft', hasOverlay: false, draftValue: false });
});

it('does not let an older reconciliation snapshot replace a projection installed while the request was in flight', async () => {
  const { runtime, metadata, thread, project } = setup();
  const heldSnapshot = deferred<Response>();
  vi.stubGlobal('fetch', vi.fn((path: string) => path === '/api/runtime' ? heldSnapshot.promise : Promise.resolve(response({ error: 'request_failed' }, 503))));
  await expect(metadata.renameThread(thread, 'Unknown value')).rejects.toBeInstanceOf(Error);
  const reconciliation = metadata.reconcileThread(thread, 'titleOverride');
  const newerProjection = { ...projection({ ...thread, titleOverride: 'new generation state', metadataVersion: 3 }, project, 3), generation: 'generation-b' };
  act(() => { runtime.getState().install(newerProjection); });
  heldSnapshot.resolve(response(bootstrap({ ...thread, titleOverride: 'stale snapshot', metadataVersion: 2 }, project, 2)));
  await reconciliation;
  expect(runtime.getState().projections[thread.machineId].generation).toBe('generation-b');
  expect(runtime.getState().confirmedThreads[threadStateKey(thread.machineId, thread.id)]).toMatchObject({ titleOverride: 'new generation state', metadataVersion: 3 });
});

it('does not clear uncertainty when reconciliation omits the affected machine projection', async () => {
  const { runtime, metadata, thread, project } = setup();
  const missingMachine = { ...bootstrap(thread, project), machines: [], projections: [], threads: [], projects: [] };
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path === '/api/runtime' ? response(missingMachine) : response({ error: 'request_failed' }, 503)));
  await expect(metadata.renameThread(thread, 'Unknown value')).rejects.toBeInstanceOf(Error);
  await expect(metadata.reconcileThread(thread, 'titleOverride')).rejects.toThrow(/omitted the affected machine/);
  expect(runtime.getState().confirmedThreads[threadStateKey(thread.machineId, thread.id)].titleOverride).toBeUndefined();
  expect(runtime.getState().metadataFields[metadataFieldKey('thread', thread.machineId, thread.id, 'titleOverride')].status).toBe('uncertain');
});

it('rejects a reconciliation snapshot from a different recovery scope without adopting it', async () => {
  const { runtime, metadata, thread, project } = setup();
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path === '/api/runtime'
    ? response({ ...bootstrap({ ...thread, titleOverride: 'Other scope', metadataVersion: 2 }, project, 2), recoveryScope: 'scope-other' })
    : response({ error: 'request_failed' }, 503)));
  await expect(metadata.renameThread(thread, 'Unknown value')).rejects.toBeInstanceOf(Error);
  await expect(metadata.reconcileThread(thread, 'titleOverride')).rejects.toThrow(/recovery scope/);
  expect(runtime.getState().confirmedThreads[threadStateKey(thread.machineId, thread.id)].titleOverride).toBeUndefined();
  expect(runtime.getState().metadataFields[metadataFieldKey('thread', thread.machineId, thread.id, 'titleOverride')].status).toBe('uncertain');
});

it('lets a delayed original commit win by its higher server version after explicit re-save', async () => {
  vi.useFakeTimers();
  const { runtime, metadata, thread, project } = setup();
  const originalRequest = deferred<Response>();
  let postCount = 0;
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    if (path === '/api/runtime') return response(bootstrap(thread, project, 2));
    postCount++;
    if (postCount === 1) return originalRequest.promise;
    return response(threadAck(thread, 'explicit re-save', 3));
  }));
  const original = metadata.renameThread(thread, 'late original').catch(() => undefined);
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  await original;
  expect(runtime.getState().metadataFields[metadataFieldKey('thread', thread.machineId, thread.id, 'titleOverride')].status).toBe('uncertain');
  await metadata.reconcileThread(thread, 'titleOverride');
  await metadata.renameThread(thread, 'explicit re-save', true);
  act(() => { runtime.getState().install(projection({ ...thread, titleOverride: 'explicit re-save', metadataVersion: 3 }, project, 3)); });
  originalRequest.resolve(response(threadAck(thread, 'late original', 4)));
  const lateCommit = { ...thread, titleOverride: 'late original', metadataVersion: 4 };
  act(() => { runtime.getState().install(projection(lateCommit, project, 4)); });
  expect(runtime.getState().confirmedThreads[threadStateKey(thread.machineId, thread.id)]).toMatchObject({ titleOverride: 'late original', metadataVersion: 4 });
  expect(runtime.getState().threads[threadStateKey(thread.machineId, thread.id)].titleOverride).toBe('late original');
});

it('clears intents and ignores late callbacks after a recovery-scope change', async () => {
  const { runtime, metadata, thread } = setup();
  const held = deferred<Response>();
  vi.stubGlobal('fetch', vi.fn(() => held.promise));
  const request = metadata.renameThread(thread, 'old scope').catch((error) => error);
  expect(runtime.getState().threads[threadStateKey(thread.machineId, thread.id)].titleOverride).toBe('old scope');
  metadata.changeScope('scope-b');
  expect(runtime.getState().threads[threadStateKey(thread.machineId, thread.id)].titleOverride).toBeUndefined();
  held.resolve(response(threadAck(thread, 'old scope', 2)));
  await request;
  expect(runtime.getState().confirmedThreads[threadStateKey(thread.machineId, thread.id)].titleOverride).toBeUndefined();
});

it('preserves newer metadata and native title-sync versions against a stale projection', () => {
  const thread = { ...baseThread(), titleOverride: 'Current override', archivedAt: 'current-archive', metadataVersion: 5, titleSync: { version: 5, state: 'pending' as const } };
  const { runtime } = setup(thread);
  act(() => { runtime.getState().install(projection({ ...thread, titleOverride: 'Stale override', archivedAt: 'stale-archive', metadataVersion: 4, titleSync: { version: 4, state: 'failed' } }, baseProject(), 2)); });
  expect(runtime.getState().confirmedThreads[threadStateKey(thread.machineId, thread.id)]).toMatchObject({ titleOverride: 'Current override', archivedAt: 'current-archive', metadataVersion: 5, titleSync: { version: 5, state: 'pending' } });
});

it('lets the Sidebar edit an archive draft and describes its pending value', () => {
  const thread = baseThread();
  const key = metadataFieldKey('thread', thread.machineId, thread.id, 'archived');
  const updateThreadArchiveDraft = vi.fn(async () => undefined);
  const metadata = { updateThreadArchiveDraft } as unknown as ReturnType<typeof createPendingMetadataController>;
  render(<Sidebar projects={[]} threads={[thread]} archived={[]} machines={[]} mode="threads" onModeChange={() => {}} collapsed={false} mobileOpen={false} onCollapse={() => {}} onCloseMobile={() => {}} metadata={metadata} metadataFields={{ [key]: { status: 'draft', hasOverlay: false, draftValue: true } }} />);
  expect(screen.getByRole('status').textContent).toContain('It will archive this thread.');
  fireEvent.click(screen.getByRole('button', { name: 'Change draft to unarchive' }));
  expect(updateThreadArchiveDraft).toHaveBeenCalledWith(thread, false);
});

it('keeps native title-sync and uncertain Webr metadata feedback separately accessible', () => {
  const thread = { ...baseThread(), titleOverride: 'Webr override', titleSync: { version: 2, state: 'failed' as const } };
  const key = metadataFieldKey('thread', thread.machineId, thread.id, 'titleOverride');
  const reconcileThread = vi.fn(async () => undefined);
  const metadata = { reconcileThread } as unknown as ReturnType<typeof createPendingMetadataController>;
  render(<Sidebar projects={[]} threads={[thread]} archived={[]} machines={[]} mode="threads" onModeChange={() => {}} collapsed={false} mobileOpen={false} onCollapse={() => {}} onCloseMobile={() => {}} metadata={metadata} metadataFields={{ [key]: { status: 'uncertain', hasOverlay: true, overlayValue: 'Webr override', message: 'The response timed out.' } }} />);
  expect(screen.queryByText('Saved in Webr; native title sync failed.')).toBeNull();
  expect(screen.getByRole('alert').textContent).toContain('Thread title save outcome is uncertain. The response timed out.');
  fireEvent.click(screen.getByRole('button', { name: 'Reconcile' }));
  expect(reconcileThread).toHaveBeenCalledWith(thread, 'titleOverride');
});

it('shows native title-sync failure only after the matching Webr title version is confirmed', () => {
  const thread = { ...baseThread(), titleOverride: 'Saved override', metadataVersion: 2, titleSync: { version: 2, state: 'failed' as const } };
  const key = metadataFieldKey('thread', thread.machineId, thread.id, 'titleOverride');
  render(<Sidebar projects={[]} threads={[thread]} archived={[]} machines={[]} mode="threads" onModeChange={() => {}} collapsed={false} mobileOpen={false} onCollapse={() => {}} onCloseMobile={() => {}} metadataFields={{ [key]: { status: 'saved', hasOverlay: false } }} />);
  expect(screen.getByRole('status').textContent).toContain('Saved in Webr; native title sync failed.');
  cleanup();
  const unconfirmed = { ...thread, titleOverride: 'New optimistic title', metadataVersion: 1, titleSync: { version: 1, state: 'failed' as const } };
  render(<Sidebar projects={[]} threads={[unconfirmed]} archived={[]} machines={[]} mode="threads" onModeChange={() => {}} collapsed={false} mobileOpen={false} onCollapse={() => {}} onCloseMobile={() => {}} metadataFields={{ [key]: { status: 'saved', hasOverlay: true, overlayValue: 'New optimistic title', canonical: { metadataVersion: 2, value: 'New optimistic title' } } }} />);
  expect(screen.queryByText('Saved in Webr; native title sync failed.')).toBeNull();
});

it('uses the display-title selector for accessible and launch-fallback surfaces', () => {
  const thread = { ...baseThread(), titleOverride: 'Webr override', prompt: '', bindingState: 'detached' as const };
  expect(threadDisplayTitle(thread)).toBe('Webr override');
  render(<ThreadView thread={thread} connected={false} canControl={false} onFocusPane={() => {}} focusedPane="" windowStart={0} narrow={false} />);
  expect(screen.getByRole('main', { name: 'Webr override tab' })).toBeTruthy();
  cleanup();
  render(<LaunchProgress thread={thread} />);
  expect(screen.getByText('Webr override')).toBeTruthy();
});

it('labels explicit clear-to-native and warns before re-saving an uncertain title draft', async () => {
  const thread = { ...baseThread(), titleOverride: 'Custom title' };
  const rename = vi.fn(async (_thread: Thread, _title: string | null, _confirmed?: boolean) => undefined);
  const metadata = { renameThread: rename } as unknown as ReturnType<typeof createPendingMetadataController>;
  render(<ThreadTitleEditor thread={thread} metadata={metadata} onDone={() => {}} onError={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Use native title' }));
  await waitFor(() => expect(rename).toHaveBeenCalledWith(thread, null, false));
  cleanup();
  const key = metadataFieldKey('thread', thread.machineId, thread.id, 'titleOverride');
  render(<ThreadTitleEditor thread={thread} metadata={metadata} metadataFields={{ [key]: { status: 'draft', hasOverlay: false, draftValue: 'Editable draft', requiresResaveConfirmation: true } }} onDone={() => {}} onError={() => {}} />);
  const input = screen.getByRole('textbox', { name: 'Rename Custom title' });
  expect((input as HTMLInputElement).value).toBe('Editable draft');
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(rename).toHaveBeenCalledWith(thread, 'Editable draft', true));
  const { confirmDialog } = await import('../../src/components/dialogs');
  expect(confirmDialog).toHaveBeenCalledWith(expect.stringContaining('whichever metadata write commits last wins'), { confirmLabel: 'Re-save anyway' });
});

it('identifies the machine scope when renaming a location in a cross-machine project group', async () => {
  const localProject = baseProject();
  const remoteProject = { ...baseProject(), id: 'project-remote', machineId: 'machine-b', name: 'Remote project' };
  const localThread = { ...baseThread(), projectId: localProject.id };
  const remoteThread = { ...baseThread(), id: 'thread-remote', machineId: 'machine-b', projectId: remoteProject.id };
  const remoteMachine = { ...machine, id: 'machine-b', name: 'Machine B' };
  render(<Sidebar projects={[localProject, remoteProject]} threads={[localThread, remoteThread]} machines={[machine, remoteMachine]} mode="projects" currentId={remoteThread.id} currentMachineId={remoteMachine.id} onModeChange={() => {}} collapsed={false} mobileOpen={false} onCollapse={() => {}} onCloseMobile={() => {}} />);
  fireEvent.contextMenu(screen.getByRole('button', { name: /Remote project/ }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename project on Machine B' }));
  expect(await screen.findByRole('textbox', { name: 'Rename Remote project on Machine B' })).toBeTruthy();
});

it('offers Use native title for a string title draft', () => {
  const thread = baseThread();
  const metadata = { renameThread: vi.fn(async () => undefined) } as unknown as ReturnType<typeof createPendingMetadataController>;
  const key = metadataFieldKey('thread', thread.machineId, thread.id, 'titleOverride');
  render(<ThreadTitleEditor thread={thread} metadata={metadata} metadataFields={{ [key]: { status: 'draft', hasOverlay: false, draftValue: 'Editable title draft' } }} onDone={() => {}} onError={() => {}} />);
  expect(screen.getByRole('button', { name: 'Use native title' })).toBeTruthy();
});

it('allows explicitly re-saving a reconciled clear-to-native title draft', async () => {
  const thread = baseThread();
  const rename = vi.fn(async (_thread: Thread, _title: string | null, _confirmed?: boolean) => undefined);
  const metadata = { renameThread: rename } as unknown as ReturnType<typeof createPendingMetadataController>;
  const key = metadataFieldKey('thread', thread.machineId, thread.id, 'titleOverride');
  const { confirmDialog } = await import('../../src/components/dialogs');
  vi.mocked(confirmDialog).mockClear();
  render(<ThreadTitleEditor thread={thread} metadata={metadata} metadataFields={{ [key]: { status: 'draft', hasOverlay: false, draftValue: null, requiresResaveConfirmation: true } }} onDone={() => {}} onError={() => {}} />);
  expect(screen.getByRole('textbox', { name: 'Rename Native title' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Use native title' }));
  await waitFor(() => expect(rename).toHaveBeenCalledWith(thread, null, true));
  expect(confirmDialog).toHaveBeenCalledWith(expect.stringContaining('whichever metadata write commits last wins'), { confirmLabel: 'Re-save anyway' });
});

it('warns before explicitly re-saving an uncertain project-name draft', async () => {
  const project = baseProject();
  const rename = vi.fn(async (_project: Project, _name: string, _confirmed?: boolean) => undefined);
  const metadata = { renameProject: rename } as unknown as ReturnType<typeof createPendingMetadataController>;
  const key = metadataFieldKey('project', project.machineId!, project.logicalId!, 'name');
  const { confirmDialog } = await import('../../src/components/dialogs');
  vi.mocked(confirmDialog).mockClear();
  render(<ProjectNameEditor project={project} machineName="Machine A" metadata={metadata} metadataFields={{ [key]: { status: 'draft', hasOverlay: false, draftValue: 'Editable project draft', requiresResaveConfirmation: true } }} onDone={() => {}} onError={() => {}} />);
  const input = screen.getByRole('textbox', { name: 'Rename Original project on Machine A' });
  expect((input as HTMLInputElement).value).toBe('Editable project draft');
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(rename).toHaveBeenCalledWith(project, 'Editable project draft', true));
  expect(confirmDialog).toHaveBeenCalledWith(expect.stringContaining('whichever metadata write commits last wins'), { confirmLabel: 'Re-save anyway' });
});

it('sets the document title from the Webr override while retaining the native title field', async () => {
  const thread = { ...baseThread(), titleOverride: 'Document override' };
  const initialUrl = `/threads/${encodeURIComponent(thread.id)}`;
  window.history.replaceState(null, '', initialUrl);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  render(<App initialUrl={window.location.href} bootstrap={bootstrap(thread)} />);
  await waitFor(() => expect(document.title).toBe('Document override · Webr'));
  expect(thread.title).toBe('Native title');
});

it('uses the display-title selector for Command Palette labels and search', () => {
  const thread = { ...baseThread(), titleOverride: 'Searchable override' };
  expect(threadDisplayTitle(thread)).toBe('Searchable override');
});
