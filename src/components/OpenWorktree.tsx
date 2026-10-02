import { useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { useQuery } from '@tanstack/react-query';
import { navigate } from 'astro:transitions/client';
import { GitBranch, Search } from 'lucide-react';
import type { Project } from '../lib/models';
import { ComposerCombobox } from './ComposerCombobox';
import { ProjectPicker } from './ProjectPicker';
import { alertDialog } from './dialogs';

type Worktree = { path: string; branch: string | null; label: string };

const fetchWorktrees = async (project: Project, signal: AbortSignal) => {
  const query = new URLSearchParams({ machineId: project.machineId ?? 'local', projectId: project.id });
  const response = await fetch(`/api/worktrees?${query}`, { signal });
  if (!response.ok) throw new Error('Could not list worktrees.');
  return await response.json() as Worktree[];
};
const openWorktree = async (project: Project, worktree: Worktree) => {
  const response = await fetch('/api/worktrees/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ machineId: project.machineId ?? 'local', projectId: project.id, path: worktree.path }) });
  if (!response.ok) throw new Error('Could not open this worktree.');
  return (await response.json() as { id: string }).id;
};

function WorktreePicker({ projects, currentProjectId, onOpened }: { projects: Project[]; currentProjectId?: string; onOpened: () => void }) {
  const [projectId, setProjectId] = useState(currentProjectId ?? projects[0]?.id ?? '');
  const [opening, setOpening] = useState('');
  const project = projects.find((item) => item.id === projectId) ?? projects[0];
  const worktrees = useQuery({ queryKey: ['worktrees', project?.machineId, project?.id], enabled: !!project, queryFn: ({ signal }) => fetchWorktrees(project!, signal) });
  const choose = async (worktree: Worktree) => {
    setOpening(worktree.path);
    try { const id = await openWorktree(project!, worktree); onOpened(); await navigate(`/threads/${encodeURIComponent(id)}`); }
    catch (error) { void alertDialog(error instanceof Error ? error.message : 'Could not open this worktree.'); }
    finally { setOpening(''); }
  };
  const options = (worktrees.data ?? []).map((worktree) => ({ value: worktree.path, label: worktree.branch ?? worktree.label, icon: <GitBranch size={14} /> }));
  return <>
    <ProjectPicker projects={projects} projectId={project?.id ?? ''} onChange={setProjectId} />
    <ComposerCombobox key={project?.id} label="Worktree" value={opening} icon={<GitBranch size={14} />} options={options}
      onChange={(path) => { const worktree = worktrees.data?.find((item) => item.path === path); if (worktree) void choose(worktree); }} />
    {worktrees.isError && <p className="form-error" role="alert">Could not list worktrees.</p>}
    {worktrees.data && !worktrees.data.length && <p className="open-worktree-empty">Every worktree of this project already has a thread.</p>}
  </>;
}

export function OpenWorktree({ projects, currentProjectId }: { projects: Project[]; currentProjectId?: string }) {
  const [open, setOpen] = useState(false);
  return <Dialog.Root open={open} onOpenChange={setOpen}>
    <Dialog.Trigger className="sidebar-open-worktree" aria-label="Open existing worktree" title="Open existing worktree" disabled={!projects.length}>
      <Search size={16} aria-hidden="true" />
    </Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Backdrop className="dialog-backdrop" />
      <Dialog.Popup className="dialog open-worktree">
        <Dialog.Title className="open-worktree-title">Open a worktree</Dialog.Title>
        <WorktreePicker projects={projects} currentProjectId={currentProjectId} onOpened={() => setOpen(false)} />
      </Dialog.Popup>
    </Dialog.Portal>
  </Dialog.Root>;
}
