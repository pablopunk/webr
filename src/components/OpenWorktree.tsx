import { useState } from 'react';
import { Menu } from '@base-ui/react/menu';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AppNavigate } from '../client/app-navigation';
import { isAccessLossError, useRuntimeCacheScope } from '../client/provider';
import { ChevronRight, FolderGit2, GitBranch, Search } from 'lucide-react';
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
  if (!response.ok) throw Object.assign(new Error('Could not list worktrees.'), { status: response.status });
  return await response.json() as Worktree[];
};
const openWorktree = async (project: Project, worktree: Worktree) => {
  const response = await fetch('/api/worktrees/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ machineId: project.machineId ?? 'local', projectId: project.id, path: worktree.path }) });
  if (!response.ok) throw new Error('Could not open this worktree.');
  return (await response.json() as { id: string }).id;
};
const openAndShow = async (project: Project, worktree: Worktree, onNavigate: AppNavigate | undefined, onOpened: () => void) => {
  try {
    const id = await openWorktree(project, worktree);
    onOpened();
    onNavigate?.(`/threads/${encodeURIComponent(id)}`);
  } catch (error) { void alertDialog(error instanceof Error ? error.message : 'Could not open this worktree.'); }
};
const keepTypingInsideInput = (event: React.KeyboardEvent) => { if (event.key.length === 1 || event.key === 'Backspace') event.stopPropagation(); };

function WorktreeSearch({ project, onNavigate }: { project: Project; onNavigate?: AppNavigate }) {
  const [query, setQuery] = useState('');
  const queryClient = useQueryClient();
  const cacheScope = useRuntimeCacheScope();
  const machineId = project.machineId ?? 'local';
  const queryKey = ['worktrees', cacheScope, machineId, project.id] as const;
  const worktrees = useQuery({ queryKey, queryFn: ({ signal }) => fetchWorktrees(project, signal), staleTime: 15_000, gcTime: 5 * 60_000 });
  const accessLost = isAccessLossError(worktrees.error);
  const matches = (accessLost ? [] : worktrees.data ?? []).filter((worktree) => matchesSearch(worktree, query));
  const invalidateWorktrees = () => { void queryClient.invalidateQueries({ queryKey }); };
  return <>
    <div className="composer-select-search"><Search size={14} aria-hidden="true" />
      <input autoFocus aria-label="Search worktrees" placeholder="Search worktrees…" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={keepTypingInsideInput} />
    </div>
    <div className="worktree-menu-list">
      {worktrees.isLoading && <div className="worktree-menu-skeleton" role="status" aria-label="Loading worktrees">
        <span className="read-skeleton-row" /><span className="read-skeleton-row" /><span className="read-skeleton-row" />
      </div>}
      {matches.map((worktree) => <Tooltip key={worktree.path} label={worktree.path} side="right"><Menu.Item className="thread-menu-item" onClick={() => void openAndShow(project, worktree, onNavigate, invalidateWorktrees)}>
        <GitBranch size={14} aria-hidden="true" /><span className="worktree-menu-name">{worktreeName(worktree)}<small>{folderName(worktree)}</small></span>
      </Menu.Item></Tooltip>)}
      {worktrees.isError && <p className="worktree-menu-note" role={accessLost || !worktrees.data ? 'alert' : 'status'}>{worktrees.data && !accessLost ? 'Could not refresh worktrees. Showing cached results.' : 'Could not list worktrees.'}</p>}
      {worktrees.data && !accessLost && !matches.length && <p className="worktree-menu-note">{worktrees.data.length ? 'No matches' : 'Every worktree already has a thread'}</p>}
    </div>
  </>;
}

export function OpenWorktree({ projects, onNavigate }: { projects: Project[]; onNavigate?: AppNavigate }) {
  return <Menu.Root>
    <Tooltip label="Open existing worktree"><Menu.Trigger className="sidebar-action-icon" aria-label="Open existing worktree" disabled={!projects.length}>
      <FolderGit2 size={16} aria-hidden="true" />
    </Menu.Trigger></Tooltip>
    <Menu.Portal><Menu.Positioner className="thread-menu-positioner" sideOffset={6} align="start"><Menu.Popup className="thread-menu">
      {projects.map((project) => <Menu.SubmenuRoot key={`${project.machineId}:${project.id}`}>
        <Menu.SubmenuTrigger className="thread-menu-item"><ProjectIcon project={project} /><span>{project.name}</span><ChevronRight size={14} aria-hidden="true" className="worktree-menu-chevron" /></Menu.SubmenuTrigger>
        <Menu.Portal><Menu.Positioner className="thread-menu-positioner" sideOffset={4} alignOffset={-4}><Menu.Popup className="thread-menu worktree-menu"><WorktreeSearch project={project} onNavigate={onNavigate} /></Menu.Popup></Menu.Positioner></Menu.Portal>
      </Menu.SubmenuRoot>)}
    </Menu.Popup></Menu.Positioner></Menu.Portal>
  </Menu.Root>;
}
