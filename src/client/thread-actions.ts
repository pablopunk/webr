import type { Project, Thread } from '../lib/models';

const actionErrors: Record<string, string> = {
  machine_disconnected: 'The machine is not connected.',
  workspace_creation_unavailable: 'This Herdr machine cannot create a terminal.',
  launch_in_progress: 'Wait for the launch to finish, then try again.',
  thread_not_found: 'This thread does not exist anymore.',
  tab_not_found: 'This terminal does not exist anymore.',
  binding_conflict: 'This terminal is now owned by a thread.',
  terminal_close_unavailable: 'This Herdr machine cannot close a terminal.',
};

async function post(path: string, body: Record<string, unknown> = {}) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(actionErrors[result.error ?? ''] ?? 'Herdr could not complete this action.');
  return result;
}

export const setThreadArchived = (thread: Thread, archived: boolean) => post(`/api/threads/${encodeURIComponent(thread.id)}/archive`, { machineId: thread.machineId, archived });
export const renameThread = (thread: Thread, title: string) => post(`/api/threads/${encodeURIComponent(thread.id)}/rename`, { machineId: thread.machineId, title });
export const renameProject = (project: Project, name: string) => post('/api/projects/rename', { machineId: project.machineId ?? 'local', logicalId: project.logicalId ?? project.id, name });
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
export const openThreadTerminal = (thread: Thread, afterPaneId: string) => post(`/api/threads/${encodeURIComponent(thread.id)}/panes/terminal`, { machineId: thread.machineId, afterPaneId }) as Promise<{ paneId: string }>;
export async function createTerminalTab(machineId: string, path: string, key: string) {
  const response = await fetch('/api/terminals', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify({ machineId, path }) });
  const result = await response.json().catch(() => ({})) as { error?: string; state?: string; tabId?: string };
  if (!response.ok) throw new Error(actionErrors[result.error ?? ''] ?? 'Herdr could not create a terminal.');
  if (result.state === 'unknown' || !result.tabId) throw new Error('The new terminal is not ready yet; check the Herdr session before trying again.');
  return { tabId: result.tabId };
}
export const closeThreadPane = (thread: Thread, paneId: string, force: boolean) => post(`/api/threads/${encodeURIComponent(thread.id)}/panes/close`, { machineId: thread.machineId, paneId, force }) as Promise<{ closed: boolean; busy: boolean }>;
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
