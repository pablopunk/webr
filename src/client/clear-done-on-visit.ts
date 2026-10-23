import { useEffect, useRef, useState } from 'react';
import type { Thread } from '../lib/models';
import { hasUnseenDone } from '../lib/models';

export function useClearDoneOnVisit(thread: Thread | undefined) {
  const latched = hasUnseenDone(thread);
  const sent = useRef(new Set<string>());
  const [attempt, setAttempt] = useState(0);
  const key = thread && latched ? `${thread.id}:${thread.doneAt ?? ''}` : '';
  useEffect(() => {
    if (!thread || !key || !latched || sent.current.has(key)) return;
    sent.current.add(key);
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const retry = () => {
      sent.current.delete(key);
      retryTimer = setTimeout(() => setAttempt((value) => value + 1), 1000);
    };
    void fetch(`/api/threads/${encodeURIComponent(thread.id)}/viewed`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ machineId: thread.machineId }) })
      .then((response) => { if (!response.ok) retry(); })
      .catch(retry);
    return () => { if (retryTimer) clearTimeout(retryTimer); };
  }, [thread?.id, thread?.machineId, key, latched, attempt]);
}
