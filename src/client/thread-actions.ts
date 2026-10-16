import type { Project, Thread } from '../lib/models';
import type { ProjectRenameResponse, ThreadArchiveResponse, ThreadRenameResponse } from '../shared/runtime';

const actionErrors: Record<string, string> = {
  machine_disconnected: 'The machine is not connected.',
  workspace_creation_unavailable: 'This Herdr machine cannot create a terminal.',
  launch_in_progress: 'Wait for the launch to finish, then try again.',
  thread_not_found: 'This thread does not exist anymore.',
  tab_not_found: 'This terminal does not exist anymore.',
  binding_conflict: 'This terminal is now owned by a thread.',
  read_only: 'This machine is read-only.',
};

export class MetadataActionError extends Error {
  constructor(readonly status: number, readonly errorCode: string | undefined, message: string) { super(message); this.name = 'MetadataActionError'; }
}
export class MetadataProtocolError extends Error {
  constructor(readonly status: number, message = 'The server returned an invalid metadata acknowledgement.') { super(message); this.name = 'MetadataProtocolError'; }
}

async function post(path: string, body: Record<string, unknown> = {}) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(actionErrors[result.error ?? ''] ?? 'Herdr could not complete this action.');
  return result;
}

async function postMetadata(path: string, body: Record<string, unknown>, endpoint: string): Promise<unknown> {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => undefined) as { error?: unknown } | undefined;
  if (!response.ok) {
    const code = typeof result?.error === 'string' ? result.error : undefined;
    throw new MetadataActionError(response.status, code, actionErrors[code ?? ''] ?? 'Herdr could not confirm this metadata change.');
  }
  if (result === undefined) throw new MetadataProtocolError(response.status, `The ${endpoint} response was not valid JSON.`);
  return result;
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const version = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const nullableString = (value: unknown): value is string | null => value === null || typeof value === 'string';
function threadAcknowledgement(value: unknown): value is ThreadRenameResponse {
  if (!record(value) || typeof value.entityId !== 'string' || !version(value.metadataVersion) || !record(value.metadata) || !nullableString(value.metadata.titleOverride) || !nullableString(value.metadata.archivedAt) || typeof value.title !== 'string') return false;
  return true;
}
function archiveAcknowledgement(value: unknown): value is ThreadArchiveResponse {
  return threadAcknowledgement({ ...(record(value) ? value : {}), title: '' }) && record(value) && typeof value.archived === 'boolean' && value.archived === ((value.metadata as Record<string, unknown>).archivedAt !== null);
}
function projectAcknowledgement(value: unknown): value is ProjectRenameResponse {
  return record(value) && typeof value.machineId === 'string' && typeof value.entityId === 'string' && version(value.metadataVersion) && record(value.metadata) && typeof value.metadata.name === 'string' && typeof value.name === 'string' && value.name === value.metadata.name;
}

export async function setThreadArchived(thread: Thread, archived: boolean): Promise<ThreadArchiveResponse> {
  const result = await postMetadata(`/api/threads/${encodeURIComponent(thread.id)}/archive`, { machineId: thread.machineId, archived }, 'thread archive');
  if (!archiveAcknowledgement(result)) throw new MetadataProtocolError(200);
  return result;
}
export async function renameThread(thread: Thread, title: string | null): Promise<ThreadRenameResponse> {
  const result = await postMetadata(`/api/threads/${encodeURIComponent(thread.id)}/rename`, { machineId: thread.machineId, title }, 'thread rename');
  if (!threadAcknowledgement(result)) throw new MetadataProtocolError(200);
  return result;
}
export async function renameProject(project: Project, name: string): Promise<ProjectRenameResponse> {
  const result = await postMetadata('/api/projects/rename', { machineId: project.machineId ?? 'local', logicalId: project.logicalId ?? project.id, name }, 'project rename');
  if (!projectAcknowledgement(result)) throw new MetadataProtocolError(200);
  return result;
}
export async function fetchRuntimeMetadataBootstrap(): Promise<unknown> {
  const response = await fetch('/api/runtime', { headers: { Accept: 'application/json' }, cache: 'no-store' });
  const result = await response.json().catch(() => undefined) as { error?: unknown } | undefined;
  if (!response.ok) throw new MetadataActionError(response.status, typeof result?.error === 'string' ? result.error : undefined, 'Could not reconcile metadata with the server.');
  if (result === undefined) throw new MetadataProtocolError(response.status, 'The runtime response was not valid JSON.');
  return result;
}
const projectIconUrl = (project: Project) => `/api/projects/icon?machineId=${encodeURIComponent(project.machineId ?? 'local')}&logicalId=${encodeURIComponent(project.logicalId ?? project.id)}`;
export async function setProjectIcon(project: Project, png: Blob) {
  const response = await fetch(projectIconUrl(project), { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: png });
  if (!response.ok) throw new Error('Could not save this icon.');
}
export type IconCandidateOption = { name: string; url: string };
export async function fetchIconCandidates(project: Project): Promise<IconCandidateOption[]> {
  const response = await fetch(`/api/projects/${encodeURIComponent(project.machineId ?? 'local')}/${encodeURIComponent(project.id)}/icon-candidates`);
  return response.ok ? await response.json() : [];
}
export async function resetProjectIcon(project: Project) {
  const response = await fetch(projectIconUrl(project), { method: 'DELETE' });
  if (!response.ok) throw new Error('Could not reset this icon.');
}
const paneActionErrors: Record<string, string> = {
  machine_disconnected: 'The machine is not connected.',
  thread_not_found: 'This thread does not exist anymore.',
  read_only: 'This machine is read-only.',
  pane_action_unavailable: 'This Herdr machine cannot change panes.',
  pane_action_refused: 'Herdr could not check whether the pane action was safe to start.',
  pane_outcome_unknown: 'Herdr could not confirm the pane action.',
};

export class PaneActionError extends Error {
  constructor(readonly status: number, readonly errorCode: string | undefined, readonly outcomeUncertain: boolean, message: string) {
    super(message);
    this.name = 'PaneActionError';
  }
}

async function postPaneAction(path: string, body: Record<string, unknown>, action: 'split' | 'close'): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new PaneActionError(0, undefined, true, `The ${action} request lost its connection; its outcome is uncertain.`);
  }
  const result = await response.json().catch(() => undefined) as unknown;
  if (!response.ok) {
    const code = record(result) && typeof result.error === 'string' ? result.error : undefined;
    const uncertain = response.status === 408 || response.status >= 500 || code === 'pane_outcome_unknown';
    throw new PaneActionError(response.status, code, uncertain, paneActionErrors[code ?? ''] ?? `Herdr could not confirm this ${action} action.`);
  }
  if (!record(result)) throw new PaneActionError(response.status, undefined, true, `The ${action} response was invalid; its outcome is uncertain.`);
  return result;
}

export async function openThreadTerminal(thread: Thread, afterPaneId: string): Promise<{ paneId: string }> {
  const result = await postPaneAction(`/api/threads/${encodeURIComponent(thread.id)}/panes/terminal`, { machineId: thread.machineId, afterPaneId }, 'split');
  if (!record(result) || typeof result.paneId !== 'string' || !result.paneId) throw new PaneActionError(200, undefined, true, 'The split response did not identify a pane; its outcome is uncertain.');
  return { paneId: result.paneId };
}
export async function closeThreadPane(thread: Thread, paneId: string, force: boolean): Promise<{ closed: boolean; busy: boolean }> {
  const result = await postPaneAction(`/api/threads/${encodeURIComponent(thread.id)}/panes/close`, { machineId: thread.machineId, paneId, force }, 'close');
  if (!record(result) || typeof result.closed !== 'boolean' || typeof result.busy !== 'boolean' || result.closed && result.busy) throw new PaneActionError(200, undefined, true, 'The close response was invalid; its outcome is uncertain.');
  return { closed: result.closed, busy: result.busy };
}
export const closeTerminalTab = (machineId: string, tabId: string, force: boolean) => post('/api/tabs/close', { machineId, tabId, force }) as Promise<{ closed: boolean; busy: boolean }>;
export const deleteThreadPermanently = (thread: Thread) => post(`/api/threads/${encodeURIComponent(thread.id)}/delete`, { machineId: thread.machineId });
export const deleteArchivedThreads = () => post('/api/archive/delete') as Promise<{ deleted: number; orphanTabsDeleted: number; failed: string[]; skippedMachines: string[] }>;
const plural = (count: number, one: string, many: string) => count === 1 ? one : many;
export function deleteWarning(threads: Thread[]) {
  const count = threads.length; const worktrees = threads.filter((thread) => thread.ownsWorktree).length;
  const subject = plural(count, 'Delete this thread', `Delete ${count} threads`);
  const closes = plural(count, 'its terminal', 'their terminals');
  if (!worktrees) return `${subject} permanently? This closes ${closes}. Your project files stay untouched.`;
  const removes = worktrees === count ? plural(count, 'its worktree', 'their worktrees') : `${worktrees} ${plural(worktrees, 'worktree', 'worktrees')}`;
  return `${subject} permanently? This closes ${closes} and removes ${removes}, including uncommitted changes.`;
}
export function deleteArchivedWarning(threads: Thread[]) {
  return `${deleteWarning(threads)} Standalone terminal tabs and agents not represented as threads are also closed; their worktrees and project files stay untouched.`;
}
