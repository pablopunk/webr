import { useEffect, useRef, useState } from 'react';
import type { Project } from '../lib/models';
import { renameProject } from '../client/thread-actions';

export function ProjectNameEditor({ project, onDone, onError }: { project: Project; onDone: () => void; onError: (error: unknown) => void }) {
  const [name, setName] = useState(project.name);
  const input = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  const finish = (save: boolean) => {
    if (finished.current) return;
    finished.current = true; onDone();
    const next = name.trim();
    if (save && next && next !== project.name) void renameProject(project, next).catch(onError);
  };
  return <input ref={input} className="thread-name-input group-name-input" aria-label={`Rename ${project.name}`} value={name} maxLength={90}
    onChange={(event) => setName(event.target.value)} onBlur={() => finish(true)} onClick={(event) => event.stopPropagation()}
    onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter') finish(true); if (event.key === 'Escape') finish(false); }} />;
}
