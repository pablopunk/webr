import { useEffect, useRef, useState } from 'react';
import type { Project } from '../lib/models';
import { ProjectIcon } from './ProjectIcon';

export function ProjectPicker({ projects, projectId, onChange }: {
  projects: Project[]; projectId: string; onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = projects.find((project) => project.id === projectId);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  return <span ref={root} className="project-picker">
    <button ref={trigger} type="button" aria-label="Choose project" aria-expanded={open} aria-haspopup="listbox" onClick={() => setOpen((value) => !value)} onKeyDown={(event) => {
      if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>('[role="option"]')?.focus()); }
    }}>{selected?.name ?? 'a project'}</button>
    {open && <span className="project-picker-options" role="listbox" aria-label="Projects" onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const options = [...root.current!.querySelectorAll<HTMLButtonElement>('[role="option"]')];
        const index = options.indexOf(document.activeElement as HTMLButtonElement);
        options[(index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus();
      }
    }}>
      {projects.map((project) => <button key={project.id} type="button" role="option" aria-selected={projectId === project.id} onClick={() => {
        onChange(project.id); setOpen(false); trigger.current?.focus();
      }}><ProjectIcon project={project} /><span>{project.name}</span></button>)}
    </span>}
  </span>;
}
