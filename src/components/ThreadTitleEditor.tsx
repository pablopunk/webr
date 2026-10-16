import { useEffect, useRef, useState } from 'react';
import type { Thread } from '../lib/models';
import { renameThread } from '../client/thread-actions';
import { threadDisplayTitle, threadTitleFieldKey, type PendingMetadataController } from '../client/pending-metadata';
import type { MetadataFieldSnapshot } from '../client/store';
import { confirmDialog } from './dialogs';

const resaveWarning = 'The original save may still commit after this re-save. Task 011 has no server fence: whichever metadata write commits last wins, even if it was sent earlier, and the later server version becomes authoritative. Continue with this explicit re-save?';

export function ThreadTitleEditor({ thread, onDone, onError, metadata, metadataFields = {} }: {
  thread: Thread; onDone: () => void; onError: (error: unknown) => void;
  metadata?: PendingMetadataController; metadataFields?: Record<string, MetadataFieldSnapshot>;
}) {
  const field = metadataFields[threadTitleFieldKey(thread)];
  const initialDraft = field?.status === 'draft' ? field.draftValue : undefined;
  const [title, setTitle] = useState<string>(() => typeof initialDraft === 'string' ? initialDraft : threadDisplayTitle(thread));
  const input = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);

  const save = async (next: string | null) => {
    const resave = field?.status === 'draft' || field?.requiresResaveConfirmation === true;
    if (resave && !await confirmDialog(resaveWarning, { confirmLabel: 'Re-save anyway' })) return;
    const request = metadata ? metadata.renameThread(thread, next, resave) : renameThread(thread, next);
    void request.catch(onError);
  };
  const finish = (shouldSave: boolean) => {
    if (finished.current) return;
    finished.current = true;
    onDone();
    const next = title.trim();
    if (shouldSave && next && next !== threadDisplayTitle(thread)) void save(next);
  };
  const clearOverride = () => {
    if (finished.current) return;
    finished.current = true;
    onDone();
    void save(null);
  };

  return <span className="metadata-editor">
    <input ref={input} className="thread-name-input" aria-label={`Rename ${threadDisplayTitle(thread)}`} value={title} maxLength={90}
      onChange={(event) => setTitle(event.target.value)} onBlur={() => finish(true)} onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter') finish(true); if (event.key === 'Escape') finish(false); }} />
    {(thread.titleOverride != null || field?.status === 'draft') && <button type="button" className="metadata-clear-override" aria-label="Use native title" title="Use native title" onMouseDown={(event) => event.preventDefault()} onClick={(event) => { event.stopPropagation(); clearOverride(); }}>Use native title</button>}
    {field?.status === 'draft' && typeof initialDraft !== 'string' && <span className="metadata-editor-note" role="status">Draft will use the native title.</span>}
  </span>;
}
