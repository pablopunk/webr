import { useEffect, useRef, useState } from 'react';
import type { Thread } from '../lib/models';
import { renameThread } from '../client/thread-actions';

export function ThreadTitleEditor({ thread, onDone, onError }: { thread: Thread; onDone: () => void; onError: (error: unknown) => void }) {
  const [title, setTitle] = useState(thread.title);
  const input = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  const finish = (save: boolean) => {
    if (finished.current) return;
    finished.current = true; onDone();
    const next = title.trim();
    if (save && next && next !== thread.title) void renameThread(thread, next).catch(onError);
  };
  return <input ref={input} className="thread-name-input" aria-label={`Rename ${thread.title}`} value={title} maxLength={90}
    onChange={(event) => setTitle(event.target.value)} onBlur={() => finish(true)} onClick={(event) => event.stopPropagation()}
    onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter') finish(true); if (event.key === 'Escape') finish(false); }} />;
}
