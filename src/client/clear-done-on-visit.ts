import { useEffect, useRef } from 'react';
import type { Thread } from '../lib/models';
import { hasUnseenDone } from '../lib/models';

export function useClearDoneOnVisit(thread: Thread | undefined) {
  const latched = hasUnseenDone(thread);
  const sent = useRef(new Set<string>());
  const key = thread && latched ? `${thread.id}:${thread.doneAt ?? ''}` : '';
  useEffect(() => {
    if (!thread || !key || !latched || sent.current.has(key)) return;
    sent.current.add(key);
    void fetch(`/api/threads/${encodeURIComponent(thread.id)}/viewed`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ machineId: thread.machineId }) })
      .then((response) => { if (!response.ok) sent.current.delete(key); })
      .catch(() => { sent.current.delete(key); });
  }, [thread?.id, thread?.machineId, key, latched]);
}
