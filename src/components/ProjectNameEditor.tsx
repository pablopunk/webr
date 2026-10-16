import { useEffect, useRef, useState } from 'react';
import type { Project } from '../lib/models';
import { renameProject } from '../client/thread-actions';
import { projectNameFieldKey, type PendingMetadataController } from '../client/pending-metadata';
import type { MetadataFieldSnapshot } from '../client/store';
import { confirmDialog } from './dialogs';

const resaveWarning = 'The original save may still commit after this re-save. Task 011 has no server fence: whichever metadata write commits last wins, even if it was sent earlier, and the later server version becomes authoritative. Continue with this explicit re-save?';

export function ProjectNameEditor({ project, machineName, onDone, onError, metadata, metadataFields = {} }: {
  project: Project; machineName?: string; onDone: () => void; onError: (error: unknown) => void;
  metadata?: PendingMetadataController; metadataFields?: Record<string, MetadataFieldSnapshot>;
}) {
  const field = metadataFields[projectNameFieldKey(project)];
  const initialDraft = field?.status === 'draft' ? field.draftValue : undefined;
  const [name, setName] = useState(() => typeof initialDraft === 'string' ? initialDraft : project.name);
  const input = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  const finish = (save: boolean) => {
    if (finished.current) return;
    finished.current = true; onDone();
    const next = name.trim();
    if (!save || !next || next === project.name) return;
    void (async () => {
      const resave = field?.status === 'draft' || field?.requiresResaveConfirmation === true;
      if (resave && !await confirmDialog(resaveWarning, { confirmLabel: 'Re-save anyway' })) return;
      const request = metadata ? metadata.renameProject(project, next, resave) : renameProject(project, next);
      await request.catch(onError);
    })();
  };
  const renameLabel = machineName ? `Rename ${project.name} on ${machineName}` : `Rename ${project.name}`;
  return <span className="metadata-editor">
    <input ref={input} className="thread-name-input group-name-input" aria-label={renameLabel} value={name} maxLength={90}
      onChange={(event) => setName(event.target.value)} onBlur={() => finish(true)} onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter') finish(true); if (event.key === 'Escape') finish(false); }} />
  </span>;
}
