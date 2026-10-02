import { memo, useRef, useState, type ReactNode } from 'react';
import { ContextMenu } from '@base-ui/react/context-menu';
import { Archive, ArchiveRestore, ChevronDown, ChevronRight, CircleCheck, CircleHelp, FolderTree, GitBranch, LayoutList, MessageCircleQuestion, TriangleAlert, PanelLeftClose, PanelLeftOpen, Plus, Settings2, Trash2, X } from 'lucide-react';
import { type Project, type Thread, harnessName, relativeTime } from '../lib/models';
import { isLaunching, launchFailed, launchLabel } from '../lib/launch';
import type { Machine } from '../lib/machines';
import { ProjectIcon } from './ProjectIcon';
import { OpenWorktree } from './OpenWorktree';
import { ThreadTitleEditor } from './ThreadTitleEditor';
import { ThreadAvatar } from './ThreadAvatar';
import { Tooltip } from './Tooltip';
import { useFlipList } from './useFlipList';
import { groupProjectLocations } from '../client/project-groups';
import { alertDialog, confirmDialog } from './dialogs';
import { deleteArchivedThreads, deleteThreadPermanently, deleteWarning, setThreadArchived } from '../client/thread-actions';

export type SidebarMode = 'projects' | 'threads';

type Props = {
  projects: Project[];
  threads: Thread[];
  archived?: Thread[];
  machines: Machine[];
  currentId?: string;
  mode: SidebarMode;
  onModeChange: (mode: SidebarMode) => void;
  collapsed: boolean;
  mobileOpen: boolean;
  onCollapse: () => void;
  onCloseMobile: () => void;
  onOpenPalette?: () => void;
};

const statusLabel: Record<Thread['status'], string> = {
  working: 'Working', blocked: 'Needs input', done: 'Done', idle: 'Idle', unknown: 'Unknown',
};
const statusBadges: Partial<Record<Thread['status'], typeof CircleHelp>> = {
  blocked: MessageCircleQuestion, done: CircleCheck, unknown: CircleHelp,
};

const reportFailure = (error: unknown) => alertDialog(error instanceof Error ? error.message : 'Herdr could not complete this action.');
const confirmDelete = async (thread: Thread) => { if (await confirmDialog(deleteWarning([thread]), { confirmLabel: 'Delete', danger: true })) await deleteThreadPermanently(thread).catch(reportFailure); };

const ThreadRow = memo(function ThreadRow({ thread, project, machineName, current, showProject }: { thread: Thread; project?: Project; machineName: string; current: boolean; showProject: boolean }) {
  const archived = !!thread.archivedAt;
  const ArchiveIcon = archived ? ArchiveRestore : Archive;
  const archiveLabel = archived ? `Unarchive ${thread.title}` : `Archive ${thread.title}`;
  const [renaming, setRenaming] = useState(false);
  const editor = renaming ? <ThreadTitleEditor thread={thread} onDone={() => setRenaming(false)} onError={reportFailure} /> : undefined;
  return <ContextMenu.Root>
    <ContextMenu.Trigger className="thread-item" data-flip-id={thread.id} onDoubleClick={(event) => { event.preventDefault(); setRenaming(true); }}>
      <ThreadLink thread={thread} project={project} machineName={machineName} current={current} showProject={showProject} editor={editor} />
      <Tooltip label={archived ? 'Unarchive' : 'Archive'}><button type="button" className="thread-archive" aria-label={archiveLabel} onClick={() => void setThreadArchived(thread, !archived).catch(reportFailure)}><ArchiveIcon size={15} strokeWidth={1.8} aria-hidden="true" /></button></Tooltip>
    </ContextMenu.Trigger>
    <ContextMenu.Portal><ContextMenu.Positioner className="thread-menu-positioner"><ContextMenu.Popup className="thread-menu">
      <ContextMenu.Item className="thread-menu-item is-danger" onClick={() => void confirmDelete(thread)}><Trash2 size={14} aria-hidden="true" />Delete permanently</ContextMenu.Item>
    </ContextMenu.Popup></ContextMenu.Positioner></ContextMenu.Portal>
  </ContextMenu.Root>;
});

function ThreadLink({ thread, project, machineName, current, showProject, editor }: { thread: Thread; project?: Project; machineName: string; current: boolean; showProject: boolean; editor?: ReactNode }) {
  const launching = isLaunching(thread); const failed = launchFailed(thread);
  const StatusIcon = failed ? TriangleAlert : launching ? undefined : statusBadges[thread.status];
  const needsAttention = failed || thread.status === 'blocked' || thread.status === 'done';
  const status = launching ? launchLabel(thread) : failed ? 'Launch stopped' : statusLabel[thread.status];
  const context = launching || failed ? status : showProject ? project?.name : harnessName(thread.agent);
  const Row = editor ? 'div' : 'a';
  return <Tooltip label={`${thread.title} · ${project?.name ?? ''} · ${machineName} · ${harnessName(thread.agent)} · ${thread.model} · ${status}`} side="right"><Row className={`thread-row ${current ? 'is-current' : ''} ${needsAttention ? `needs-attention status-${failed ? 'blocked' : thread.status}` : ''}`} href={editor ? undefined : `/threads/${encodeURIComponent(thread.id)}`} aria-current={current ? 'page' : undefined} aria-label={`${thread.title} · ${project?.name ?? ''} · ${machineName} · ${status}`}>
    <span className="thread-avatar" aria-hidden="true"><ThreadAvatar thread={thread} working={thread.status === 'working' || launching} size={24} />{StatusIcon && <StatusIcon className={`thread-status status-${failed ? 'blocked' : thread.status}`} size={14} strokeWidth={2.2} />}</span>
    <span className="thread-copy"><span className="thread-context">{showProject && project && !launching && !failed && <ProjectIcon project={project} />}{thread.worktree && !launching && !failed && <GitBranch className="thread-worktree" size={11} aria-label="Worktree" />}{context}</span>{editor ?? <span className="thread-name">{thread.title}</span>}</span>
    <span className="thread-time">{relativeTime(thread.updatedAt)}</span>
  </Row></Tooltip>;
}

function ArchivedThreads({ threads, renderThread }: { threads: Thread[]; renderThread: (thread: Thread) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deleteAll = async () => {
    if (!await confirmDialog(deleteWarning(threads), { confirmLabel: 'Delete all', danger: true })) return;
    setDeleting(true);
    try { const result = await deleteArchivedThreads(); if (result.failed.length) await alertDialog(`${result.failed.length} archived ${result.failed.length === 1 ? 'thread' : 'threads'} could not be deleted.`); }
    catch (error) { reportFailure(error); } finally { setDeleting(false); }
  };
  return <section className="thread-group archived-threads" aria-label="Archived threads">
    <div className="group-header">
      <button className="group-title" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span className="group-chevron" aria-hidden="true">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span><Archive size={14} aria-hidden="true" /><span className="group-name">Archived</span><span className="group-count">{threads.length}</span>
      </button>
      <button type="button" className="archived-delete-all" onClick={() => void deleteAll()} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete all'}</button>
    </div>
    {open && threads.map(renderThread)}
  </section>;
}

export function Sidebar({ projects, threads, archived = [], machines, currentId, mode, onModeChange, collapsed, mobileOpen, onCollapse, onCloseMobile, onOpenPalette }: Props) {
  const [closedProjects, setClosedProjects] = useState<string[]>([]);
  const currentProjectId = threads.find((thread) => thread.id === currentId)?.projectId;
  const projectGroups = groupProjectLocations(projects, currentProjectId);
  const navigation = useRef<HTMLElement>(null);
  useFlipList(navigation);
  const threadLink = (thread: Thread, showProject: boolean) => {
    const project = projects.find((item) => item.id === thread.projectId);
    return <ThreadRow key={thread.id} thread={thread} project={project} machineName={machines.find((machine) => machine.id === thread.machineId)?.name ?? thread.machineId} current={currentId === thread.id} showProject={showProject} />;
  };

  return <>
    {mobileOpen && <button className="sidebar-scrim" aria-label="Close sidebar" onClick={onCloseMobile} />}
    <aside className={`sidebar ${collapsed ? 'is-collapsed' : ''} ${mobileOpen ? 'is-mobile-open' : ''}`} aria-label="Threads"
      onClick={(event) => { if (mobileOpen && (event.target as Element).closest('a[href]')) onCloseMobile(); }}>
      <div className="sidebar-header">
        {!collapsed && <span className="brand">webr</span>}
        <button className="icon-button sidebar-collapse" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={onCollapse}>{collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}</button>
        <button className="icon-button mobile-close" aria-label="Close sidebar" onClick={onCloseMobile}><X size={16} /></button>
      </div>
      <div className="sidebar-actions">
        <Tooltip label="New thread"><a className="sidebar-new-thread" href={`/new${currentProjectId ? `?project=${encodeURIComponent(currentProjectId)}` : ''}`} aria-label="New thread">
          <Plus size={16} aria-hidden="true" />{!collapsed && <span>New thread</span>}
        </a></Tooltip>
        <OpenWorktree projects={projects} />
        {!collapsed && <div className="sidebar-view-switch" role="group" aria-label="Sidebar layout">
          <Tooltip label="Show threads"><button type="button" aria-label="Show threads" aria-pressed={mode === 'threads'} onClick={() => onModeChange('threads')}><LayoutList size={16} aria-hidden="true" /></button></Tooltip>
          <Tooltip label="Group by project"><button type="button" aria-label="Group by project" aria-pressed={mode === 'projects'} onClick={() => onModeChange('projects')}><FolderTree size={16} aria-hidden="true" /></button></Tooltip>
        </div>}
      </div>
      {!collapsed && <>
        <nav ref={navigation} className="thread-navigation" aria-label="Agent threads">
          {mode === 'projects' ? projectGroups.filter((group) => threads.some((thread) => group.locations.includes(thread.projectId))).sort((a, b) => (threads.find((thread) => b.locations.includes(thread.projectId))?.updatedAt ?? '').localeCompare(threads.find((thread) => a.locations.includes(thread.projectId))?.updatedAt ?? '')).map(({ id, project, locations }) => <section key={id} className="thread-group">
            <div className="group-header">
              <button className="group-title" onClick={() => setClosedProjects((value) => value.includes(id) ? value.filter((item) => item !== id) : [...value, id])} aria-expanded={!closedProjects.includes(id)}>
                <span className="group-chevron" aria-hidden="true">{closedProjects.includes(id) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</span><ProjectIcon project={project} /><span className="group-name">{project.name}</span>
              </button>
              <Tooltip label={`New thread in ${project.name}`}><a className="group-new-thread" href={`/new?project=${encodeURIComponent(project.id)}`} aria-label={`New thread in ${project.name}`}><Plus size={15} aria-hidden="true" /></a></Tooltip>
            </div>
            {!closedProjects.includes(id) && threads.filter((thread) => locations.includes(thread.projectId)).map((thread) => threadLink(thread, false))}
          </section>) : threads.map((thread) => threadLink(thread, true))}
          {!threads.length && !archived.length && <p className="sidebar-empty">No agents yet. Press ⌘K to start one.</p>}
        </nav>
        {!!archived.length && <ArchivedThreads threads={archived} renderThread={(thread) => threadLink(thread, true)} />}
        <div className="sidebar-footer">
          <a className="sidebar-settings" href="/settings"><Settings2 size={15} /> Settings</a>
          <Tooltip label="Open command palette"><button type="button" className="sidebar-palette" aria-label="Open command palette" onClick={onOpenPalette}><kbd>⌘K</kbd></button></Tooltip>
        </div>
      </>}
    </aside>
  </>;
}
