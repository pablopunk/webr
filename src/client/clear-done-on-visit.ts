import { useEffect } from 'react';
import type { Thread } from '../lib/models';

export function useClearDoneOnVisit(thread: Thread | undefined, paneId: string, enabled: boolean) {
  const isDone = thread?.status === 'done';
  useEffect(() => {
    if (!thread || !paneId || !isDone || !enabled) return;
    void fetch(`/api/threads/${encodeURIComponent(thread.id)}/focus`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ machineId: thread.machineId, paneId }) }).catch(() => undefined);
  }, [thread?.id, thread?.machineId, paneId, isDone, enabled]);
}
