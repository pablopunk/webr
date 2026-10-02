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
export const deleteThreadPermanently = (thread: Thread) => post(`/api/threads/${encodeURIComponent(thread.id)}/delete`, { machineId: thread.machineId });
export const deleteArchivedThreads = () => post('/api/archive/delete') as Promise<{ deleted: number; failed: string[] }>;
export const deleteWarning = (count: number) => `${count === 1 ? 'Delete this thread' : `Delete ${count} threads`} permanently? This closes ${count === 1 ? 'its terminal' : 'their terminals'} and removes ${count === 1 ? 'its worktree' : 'their worktrees'}, including uncommitted changes.`;
