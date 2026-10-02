import { useState } from 'react';
import { Menu } from '@base-ui/react/menu';
import { useQuery } from '@tanstack/react-query';
import { navigate } from 'astro:transitions/client';
import { ChevronRight, GitBranch, Search } from 'lucide-react';
import type { Project } from '../lib/models';
import { ProjectIcon } from './ProjectIcon';
import { alertDialog } from './dialogs';
import { Tooltip } from './Tooltip';

type Worktree = { path: string; branch: string | null; label: string };
const projectQuery = (project: Project) => new URLSearchParams({ machineId: project.machineId ?? 'local', projectId: project.id });
const worktreeName = (worktree: Worktree) => worktree.branch ?? worktree.label;
const folderName = (worktree: Worktree) => worktree.path.split('/').at(-1) ?? '';
const matchesSearch = (worktree: Worktree, query: string) => `${worktreeName(worktree)} ${folderName(worktree)}`.toLowerCase().includes(query.trim().toLowerCase());

const fetchWorktrees = async (project: Project, signal: AbortSignal) => {
  const response = await fetch(`/api/worktrees?${projectQuery(project)}`, { signal });
  if (!response.ok) throw new Error('Could not list worktrees.');
  return await response.json() as Worktree[];
};
const openWorktree = async (project: Project, worktree: Worktree) => {
  const response = await fetch('/api/worktrees/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ machineId: project.machineId ?? 'local', projectId: project.id, path: worktree.path }) });
  if (!response.ok) throw new Error('Could not open this worktree.');
  return (await response.json() as { id: string }).id;
};
const openAndShow = async (project: Project, worktree: Worktree) => {
  try { await navigate(`/threads/${encodeURIComponent(await openWorktree(project, worktree))}`); }
  catch (error) { void alertDialog(error instanceof Error ? error.message : 'Could not open this worktree.'); }
};
const keepTypingInsideInput = (event: React.KeyboardEvent) => { if (event.key.length === 1 || event.key === 'Backspace') event.stopPropagation(); };

function WorktreeSearch({ project }: { project: Project }) {
  const [query, setQuery] = useState('');
  const worktrees = useQuery({ queryKey: ['worktrees', project.machineId, project.id], queryFn: ({ signal }) => fetchWorktrees(project, signal) });
  const matches = (worktrees.data ?? []).filter((worktree) => matchesSearch(worktree, query));
  return <>
    <div className="composer-select-search"><Search size={14} aria-hidden="true" />
      <input autoFocus aria-label="Search worktrees" placeholder="Search worktrees…" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={keepTypingInsideInput} />
    </div>
    <div className="worktree-menu-list">
      {matches.map((worktree) => <Tooltip key={worktree.path} label={worktree.path} side="right"><Menu.Item className="thread-menu-item" onClick={() => void openAndShow(project, worktree)}>
        <GitBranch size={14} aria-hidden="true" /><span className="worktree-menu-name">{worktreeName(worktree)}<small>{folderName(worktree)}</small></span>
      </Menu.Item></Tooltip>)}
      {worktrees.isError && <p className="worktree-menu-note" role="alert">Could not list worktrees.</p>}
      {worktrees.data && !matches.length && <p className="worktree-menu-note">{worktrees.data.length ? 'No matches' : 'Every worktree already has a thread'}</p>}
    </div>
  </>;
}

export function OpenWorktree({ projects }: { projects: Project[] }) {
  return <Menu.Root>
    <Tooltip label="Open existing worktree"><Menu.Trigger className="sidebar-open-worktree" aria-label="Open existing worktree" disabled={!projects.length}>
      <Search size={16} aria-hidden="true" />
    </Menu.Trigger></Tooltip>
    <Menu.Portal><Menu.Positioner className="thread-menu-positioner" sideOffset={6} align="start"><Menu.Popup className="thread-menu">
      {projects.map((project) => <Menu.SubmenuRoot key={`${project.machineId}:${project.id}`}>
        <Menu.SubmenuTrigger className="thread-menu-item"><ProjectIcon project={project} /><span>{project.name}</span><ChevronRight size={14} aria-hidden="true" className="worktree-menu-chevron" /></Menu.SubmenuTrigger>
        <Menu.Portal><Menu.Positioner className="thread-menu-positioner" sideOffset={4} alignOffset={-4}><Menu.Popup className="thread-menu worktree-menu"><WorktreeSearch project={project} /></Menu.Popup></Menu.Positioner></Menu.Portal>
      </Menu.SubmenuRoot>)}
    </Menu.Popup></Menu.Positioner></Menu.Portal>
  </Menu.Root>;
}
