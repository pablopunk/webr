import type { Thread } from '../lib/models';

const actionErrors: Record<string, string> = {
  machine_disconnected: 'The machine is not connected.',
  launch_in_progress: 'Wait for the launch to finish, then try again.',
  thread_not_found: 'This thread does not exist anymore.',
};

async function post(path: string, body: Record<string, unknown> = {}) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(actionErrors[result.error ?? ''] ?? 'Herdr could not complete this action.');
  return result;
}

export const setThreadArchived = (thread: Thread, archived: boolean) => post(`/api/threads/${encodeURIComponent(thread.id)}/archive`, { machineId: thread.machineId, archived });
export const renameThread = (thread: Thread, title: string) => post(`/api/threads/${encodeURIComponent(thread.id)}/rename`, { machineId: thread.machineId, title });
export type TerminalDirection = 'right' | 'down';
export const toggleThreadTerminal = (thread: Thread, direction: TerminalDirection) => post(`/api/threads/${encodeURIComponent(thread.id)}/terminal`, { machineId: thread.machineId, direction }) as Promise<{ paneId: string; hidden: boolean }>;
export const closeThreadTerminal = (thread: Thread) => post(`/api/threads/${encodeURIComponent(thread.id)}/terminal/close`, { machineId: thread.machineId });
export const deleteThreadPermanently = (thread: Thread) => post(`/api/threads/${encodeURIComponent(thread.id)}/delete`, { machineId: thread.machineId });
export const deleteArchivedThreads = () => post('/api/archive/delete') as Promise<{ deleted: number; failed: string[] }>;
const plural = (count: number, one: string, many: string) => count === 1 ? one : many;
export function deleteWarning(threads: Thread[]) {
  const count = threads.length; const worktrees = threads.filter((thread) => thread.ownsWorktree).length;
  const subject = plural(count, 'Delete this thread', `Delete ${count} threads`);
  const closes = plural(count, 'its terminal', 'their terminals');
  if (!worktrees) return `${subject} permanently? This closes ${closes}. Your project files stay untouched.`;
  const removes = worktrees === count ? plural(count, 'its worktree', 'their worktrees') : `${worktrees} ${plural(worktrees, 'worktree', 'worktrees')}`;
  return `${subject} permanently? This closes ${closes} and removes ${removes}, including uncommitted changes.`;
}
