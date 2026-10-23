import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { ContextMenu } from '@base-ui/react/context-menu';
import { Archive, ArchiveRestore, ChevronDown, ChevronRight, CircleCheck, CircleHelp, Command, FolderTree, GitBranch, LayoutList, MessageCircleQuestion, TriangleAlert, Pin, PanelLeftClose, PanelLeftOpen, Settings2, SquarePen, SquareTerminal, ImageUp, Pencil, Plus, Trash2, Unplug, X } from 'lucide-react';
import { type Project, type Thread, harnessName, hasUnseenDone, relativeTime } from '../lib/models';
import { isLaunching, launchFailed, launchLabel } from '../lib/launch';
import { selectTerminalMachine, type Machine } from '../lib/machines';
import { HarnessIcon } from './HarnessIcon';
import { ProjectIcon } from './ProjectIcon';
import { OpenWorktree } from './OpenWorktree';
import { ThreadTitleEditor } from './ThreadTitleEditor';
import { ProjectNameEditor } from './ProjectNameEditor';
import { ProjectIconDialog } from './ProjectIconDialog';
import { ThreadAvatar } from './ThreadAvatar';
import { Tooltip } from './Tooltip';
import { useFlipList } from './useFlipList';
import type { AppNavigate } from '../client/app-navigation';
import { openTerminalTab } from '../client/terminal-navigation';
import { groupProjectLocations } from '../client/project-groups';
import { withTildeHome } from '../client/home-path';
import { useThreadTickets } from '../client/provider';
import { alertDialog, confirmDialog } from './dialogs';
import { RENAME_THREAD_EVENT } from '../client/keyboard';
import { formatShortcut } from './shortcuts';
import { closeTerminalTab, deleteArchivedThreads, deleteArchivedWarning, deleteThreadPermanently, deleteWarning, setThreadArchived } from '../client/thread-actions';
import { projectNameFieldKey, threadArchiveFieldKey, threadDisplayTitle, threadIsArchived, threadTitleFieldKey, type PendingMetadataController } from '../client/pending-metadata';
import type { MetadataFieldSnapshot } from '../client/store';
import { sidebarTabKey, type FloatingTab } from '../lib/floating';
import { movePin, pinKey, pinnedFirst, togglePin, usePinnedKeys, type DropEdge } from '../client/pinned-threads';
import { SidebarMetrics } from './SidebarMetrics';

export type SidebarMode = 'projects' | 'threads';
const closedProjectsStorageKey = 'webr-sidebar-closed-projects';

type Props = {
  projects: Project[];
  threads: Thread[];
  archived?: Thread[];
  floating?: FloatingTab[];
  detached?: Thread[];
  ownedTabs?: Map<string, FloatingTab>;
  machines: Machine[];
  currentId?: string;
  currentMachineId?: string;
  currentTab?: { machineId: string; tabId: string };
  mode: SidebarMode;
  onModeChange: (mode: SidebarMode) => void;
  collapsed: boolean;
  mobileOpen: boolean;
  onCollapse: () => void;
  onCloseMobile: () => void;
  onNavigate?: AppNavigate;
  onOpenPalette?: () => void;
  paletteShortcut?: string;
  updateAction?: ReactNode;
  metadata?: PendingMetadataController;
  metadataFields?: Record<string, MetadataFieldSnapshot>;
};

type PinDrag = { active: () => boolean; start: (key: string) => void; over: (key: string, edge: DropEdge) => void; drop: (key: string, edge: DropEdge) => void; end: () => void };
type PinDragState = { key: string; target?: { key: string; edge: DropEdge } };
const dropEdgeOf = (event: DragEvent<HTMLElement>): DropEdge => {
  const box = event.currentTarget.getBoundingClientRect();
  return event.clientY < box.top + box.height / 2 ? 'before' : 'after';
};

const statusLabel: Record<Thread['status'], string> = {
  working: 'Working', blocked: 'Needs input', done: 'Done', idle: 'Idle', unknown: 'Unknown',
};
const statusBadges: Partial<Record<Thread['status'], typeof CircleHelp>> = {
  blocked: MessageCircleQuestion, done: CircleCheck, unknown: CircleHelp,
};

const reportFailure = (error: unknown) => alertDialog(error instanceof Error ? error.message : 'Herdr could not complete this action.');
const confirmDelete = async (thread: Thread, canDelete: boolean) => { if (canDelete && await confirmDialog(deleteWarning([thread]), { confirmLabel: 'Delete', danger: true })) await deleteThreadPermanently(thread).catch(reportFailure); };
const resaveMetadataWarning = 'The original save may still commit after this re-save. Task 011 has no server fence: whichever metadata write commits last wins, even if it was sent earlier, and the later server version becomes authoritative. Continue with this explicit re-save?';
function MetadataFeedback({ label, field, onReconcile, onEdit, onEditLabel, onResave }: { label: string; field?: MetadataFieldSnapshot; onReconcile?: () => void; onEdit?: () => void; onEditLabel?: string; onResave?: () => void }) {
  if (!field || field.status === 'saved' && !field.message) return null;
  const archiveDraftDescription = label === 'archive' && typeof field.draftValue === 'boolean' ? ` It will ${field.draftValue ? 'archive' : 'unarchive'} this thread.` : '';
  const message = field.status === 'pending' ? `Saving ${label} in Webr…`
    : field.status === 'saved' ? `Saved ${label} in Webr.`
      : field.status === 'failed' ? `Could not save ${label} in Webr. ${field.message ?? ''}`
        : field.status === 'uncertain' ? `${label[0].toUpperCase()}${label.slice(1)} save outcome is uncertain. ${field.message ?? ''}`
          : `Unsaved ${label} draft.${archiveDraftDescription} Server state is shown; the draft has not been resubmitted.`;
  const alert = field.status === 'failed' || field.status === 'uncertain';
  return <div className={`metadata-feedback is-${field.status}`} role={alert ? 'alert' : 'status'} aria-live={alert ? 'assertive' : 'polite'}>
    <span>{message}</span>
    {field.status === 'uncertain' && onReconcile && <button type="button" onClick={onReconcile}>Reconcile</button>}
    {field.status === 'draft' && onEdit && <button type="button" onClick={onEdit}>{onEditLabel ?? 'Edit draft'}</button>}
    {field.status === 'draft' && onResave && <button type="button" onClick={onResave}>Re-save</button>}
  </div>;
}
function NewTerminalButton({ machine, onNavigate }: { machine?: Machine; onNavigate?: AppNavigate }) {
  const [busy, setBusy] = useState(false);
  const tickets = useThreadTickets();
  const open = async () => {
    if (!machine || !machine.connected || !machine.writable || busy) return;
    setBusy(true);
    try { await openTerminalTab(machine, '~/', undefined, tickets, onNavigate ?? (() => {})); }
    catch (error) { reportFailure(error); }
    finally { setBusy(false); }
  };
  return <Tooltip label="New Terminal"><button type="button" className="sidebar-action-icon" aria-label="New Terminal" disabled={!machine || !machine.connected || !machine.writable || busy} onClick={() => void open()}><SquareTerminal size={16} aria-hidden="true" /></button></Tooltip>;
}

const ThreadRow = memo(function ThreadRow({ thread, project, machineName, current, showProject, href, connected, canDelete, pinnable, pinned, pinDrag, dragging, dropEdge, metadata, metadataFields = {} }: { thread: Thread; project?: Project; machineName: string; current: boolean; showProject: boolean; href: string; connected: boolean; canDelete: boolean; pinnable: boolean; pinned: boolean; pinDrag: PinDrag; dragging: boolean; dropEdge?: DropEdge; metadata?: PendingMetadataController; metadataFields?: Record<string, MetadataFieldSnapshot> }) {
  const archived = threadIsArchived(thread, metadataFields);
  const ArchiveIcon = archived ? ArchiveRestore : Archive;
  const displayTitle = threadDisplayTitle(thread);
  const titleState = metadataFields[threadTitleFieldKey(thread)];
  const archiveState = metadataFields[threadArchiveFieldKey(thread)];
  const archiveDraftValue = archiveState?.status === 'draft' && typeof archiveState.draftValue === 'boolean' ? archiveState.draftValue : undefined;
  const archiveDraft = typeof archiveDraftValue === 'boolean';
  const archiveLabel = archiveDraft ? `Change archive draft to ${archiveDraftValue ? 'unarchive' : 'archive'} ${displayTitle}` : archived ? `Unarchive ${displayTitle}` : `Archive ${displayTitle}`;
  const nativeSyncIsCurrent = !titleState || !['pending', 'uncertain', 'draft'].includes(titleState.status)
    && (titleState.canonical === undefined || thread.titleSync.version >= titleState.canonical.metadataVersion);
  const [renaming, setRenaming] = useState(false);
  const key = pinKey(thread);
  const draggable = pinned && !renaming;
  const pinLabel = `${pinned ? 'Unpin' : 'Pin'} ${displayTitle}`;
  useEffect(() => {
    if (!current) return;
    const onRenameRequest = (event: Event) => {
      if ((event as CustomEvent<string>).detail === thread.id) setRenaming(true);
    };
    window.addEventListener(RENAME_THREAD_EVENT, onRenameRequest);
    return () => window.removeEventListener(RENAME_THREAD_EVENT, onRenameRequest);
  }, [current, thread.id]);
  const editor = renaming ? <ThreadTitleEditor thread={thread} onDone={() => setRenaming(false)} onError={reportFailure} metadata={metadata} metadataFields={metadataFields} /> : undefined;
  const flipId = thread.bindingState === 'attached' && thread.tabId ? sidebarTabKey(thread.machineId, thread.tabId) : thread.id;
  const reconcile = (field: 'titleOverride' | 'archived') => { if (metadata) void metadata.reconcileThread(thread, field).catch(reportFailure); };
  const changeArchiveDraft = () => {
    if (!metadata || typeof archiveDraftValue !== 'boolean') return;
    void metadata.updateThreadArchiveDraft(thread, !archiveDraftValue).catch(reportFailure);
  };
  const resaveArchive = async () => {
    if (!metadata || typeof archiveDraftValue !== 'boolean') return;
    if (await confirmDialog(resaveMetadataWarning, { confirmLabel: 'Re-save anyway' })) void metadata.setThreadArchived(thread, archiveDraftValue, true).catch(reportFailure);
  };
  return <ContextMenu.Root>
    <ContextMenu.Trigger className={`thread-item${pinned ? ' is-pinned' : ''}${dragging ? ' is-dragging' : ''}${dropEdge ? ` drop-${dropEdge}` : ''}`} data-flip-id={flipId} data-sidebar-navigation-item="true" data-sidebar-navigation-href={href} data-sidebar-navigation-current={current ? 'true' : 'false'} onDoubleClick={(event) => { event.preventDefault(); setRenaming(true); }}
      draggable={draggable}
      onDragStart={draggable ? (event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', displayTitle); pinDrag.start(key); } : undefined}
      onDragOver={pinned ? (event) => { if (!pinDrag.active()) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; pinDrag.over(key, dropEdgeOf(event)); } : undefined}
      onDrop={pinned ? (event) => { if (!pinDrag.active()) return; event.preventDefault(); pinDrag.drop(key, dropEdgeOf(event)); pinDrag.end(); } : undefined}
      onDragEnd={draggable ? pinDrag.end : undefined}>
      <ThreadLink thread={thread} project={project} machineName={machineName} current={current} showProject={showProject} editor={editor} href={href} connected={connected} draggable={draggable ? false : undefined} />
      {pinnable && <Tooltip label={pinned ? 'Unpin' : 'Pin'}><button type="button" className={`thread-pin${pinned ? ' is-pinned' : ''}`} aria-label={pinLabel} aria-pressed={pinned} onClick={() => togglePin(key)}><Pin size={15} strokeWidth={1.8} fill={pinned ? 'currentColor' : 'none'} aria-hidden="true" /></button></Tooltip>}
      <Tooltip label={archiveDraft ? archiveLabel : archived ? 'Unarchive' : 'Archive'}><button type="button" className="thread-archive" aria-label={archiveLabel} onClick={() => archiveDraft ? changeArchiveDraft() : void (metadata ? metadata.setThreadArchived(thread, !archived) : setThreadArchived(thread, !archived)).catch(reportFailure)}><ArchiveIcon size={15} strokeWidth={1.8} aria-hidden="true" /></button></Tooltip>
    </ContextMenu.Trigger>
    <MetadataFeedback label="thread title" field={titleState} onReconcile={titleState?.status === 'uncertain' ? () => reconcile('titleOverride') : undefined} onEdit={titleState?.status === 'draft' ? () => setRenaming(true) : undefined} />
    <MetadataFeedback label="archive" field={archiveState} onReconcile={archiveState?.status === 'uncertain' ? () => reconcile('archived') : undefined} onEdit={archiveDraft ? changeArchiveDraft : undefined} onEditLabel={archiveDraft ? `Change draft to ${archiveDraftValue ? 'unarchive' : 'archive'}` : undefined} onResave={archiveDraft ? () => void resaveArchive() : undefined} />
    {nativeSyncIsCurrent && thread.titleSync.state === 'failed' && thread.titleOverride != null && <div className="metadata-feedback native-title-sync-status" role="status">Saved in Webr; native title sync failed.</div>}
    <ContextMenu.Portal><ContextMenu.Positioner className="thread-menu-positioner"><ContextMenu.Popup className="thread-menu">
      <ContextMenu.Item className="thread-menu-item is-danger" disabled={!canDelete} onClick={() => void confirmDelete(thread, canDelete)}><Trash2 size={14} aria-hidden="true" />Delete permanently</ContextMenu.Item>
    </ContextMenu.Popup></ContextMenu.Positioner></ContextMenu.Portal>
  </ContextMenu.Root>;
});

const terminalHref = (session: string, tab: FloatingTab) => `/sessions/${encodeURIComponent(session)}/tabs/${encodeURIComponent(tab.tabId)}?machine=${encodeURIComponent(tab.machineId)}`;

const TerminalRow = memo(function TerminalRow({ tab, session, machineName, current, canClose }: { tab: FloatingTab; session: string; machineName: string; current: boolean; canClose: boolean }) {
  const [closing, setClosing] = useState(false);
  const href = terminalHref(session, tab);
  const label = `${tab.label} · ${machineName} · ${tab.paneCount} pane${tab.paneCount === 1 ? '' : 's'}`;
  const close = async () => {
    if (!canClose || closing) return;
    setClosing(true);
    try {
      let result = await closeTerminalTab(tab.machineId, tab.tabId, false);
      if (result.busy && await confirmDialog(`${tab.label} is running a process. Close it anyway?`, { confirmLabel: 'Close', danger: true })) result = await closeTerminalTab(tab.machineId, tab.tabId, true);
    } catch (error) { reportFailure(error); } finally { setClosing(false); }
  };
  return <div className="thread-item" data-flip-id={sidebarTabKey(tab.machineId, tab.tabId)} data-sidebar-navigation-item="true" data-sidebar-navigation-href={href} data-sidebar-navigation-current={current ? 'true' : 'false'}>
    <Tooltip label={label} side="right"><a className={`thread-row ${current ? 'is-current' : ''}`} href={href} aria-current={current ? 'page' : undefined} aria-label={`${tab.label} · ${machineName} · Terminal`}>
      <span className="thread-avatar" aria-hidden="true"><span className="thread-bot-avatar"><SquareTerminal size={24} strokeWidth={1.6} /></span></span>
      <span className="thread-copy"><span className="thread-context">{machineName} · Terminal</span><span className="thread-name">{tab.label}</span></span>
    </a></Tooltip>
    <Tooltip label={`Close ${tab.label}`}><button type="button" className="thread-archive" aria-label={`Close ${tab.label}`} disabled={!canClose || closing} onClick={() => void close()}><X size={15} strokeWidth={1.8} aria-hidden="true" /></button></Tooltip>
  </div>;
});

function ThreadLink({ thread, project, machineName, current, showProject, editor, href, connected, draggable }: { thread: Thread; project?: Project; machineName: string; current: boolean; showProject: boolean; href: string; connected: boolean; editor?: ReactNode; draggable?: boolean }) {
  const avatar = useRef<HTMLSpanElement>(null);
  const projectSlot = useRef<HTMLSpanElement>(null);
  const launching = connected && isLaunching(thread); const failed = connected && launchFailed(thread);
  const canReplaceAvatar = !!project && !launching && !failed;
  useLayoutEffect(() => {
    const slot = projectSlot.current;
    const target = avatar.current;
    if (!slot || !target || !showProject || !canReplaceAvatar) return;
    const update = () => {
      const from = slot.getBoundingClientRect();
      const to = target.getBoundingClientRect();
      slot.style.setProperty('--project-offset-x', `${to.left + to.width / 2 - from.left - from.width / 2}px`);
      slot.style.setProperty('--project-offset-y', `${to.top + to.height / 2 - from.top - from.height / 2}px`);
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(target);
    observer.observe(slot);
    if (slot.parentElement) observer.observe(slot.parentElement);
    return () => observer.disconnect();
  }, [showProject, canReplaceAvatar, editor]);
  const displayTitle = threadDisplayTitle(thread);
  const warning = failed;
  const unseen = connected && hasUnseenDone(thread);
  const currentStatus = connected ? thread.status : 'unknown';
  const StatusIcon = warning ? TriangleAlert : launching ? undefined : unseen ? CircleCheck : currentStatus === 'done' ? undefined : statusBadges[currentStatus];
  const needsAttention = warning || currentStatus === 'blocked' || unseen;
  const status = !connected ? statusLabel.unknown : launching ? launchLabel(thread) : failed ? 'Launch stopped' : unseen ? statusLabel.done : statusLabel[currentStatus];
  const context = launching || failed ? status : showProject ? project?.name : harnessName(thread.agent);
  const hasProjectSlot = showProject && canReplaceAvatar;
  const Row = editor ? 'div' : 'a';
  return <Tooltip label={`${displayTitle} · ${project?.name ?? ''} · ${machineName} · ${harnessName(thread.agent)} · ${thread.model} · ${status}`} side="right"><Row className={`thread-row ${current ? 'is-current' : ''} ${hasProjectSlot ? 'has-project-slot' : ''} ${needsAttention ? `needs-attention status-${warning || thread.status === 'blocked' ? 'blocked' : 'done'}` : ''}`} href={editor ? undefined : href} draggable={draggable} aria-current={current ? 'page' : undefined} aria-label={`${displayTitle} · ${project?.name ?? ''} · ${machineName} · ${status}`}>
    <span ref={avatar} className={`thread-avatar ${canReplaceAvatar ? 'has-project-avatar' : ''}`} aria-hidden="true"><span className="thread-bot-avatar"><ThreadAvatar thread={thread} working={thread.status === 'working' || launching} size={24} /></span>{canReplaceAvatar && !showProject && <span className="thread-selected-project"><ProjectIcon project={project!} /></span>}{StatusIcon && <StatusIcon className={`thread-status status-${warning || thread.status === 'blocked' ? 'blocked' : unseen ? 'done' : thread.status}`} size={14} strokeWidth={2.2} />}<span className="thread-avatar-harness"><HarnessIcon harness={thread.agent} size={14} /></span></span>
    <span className="thread-copy"><span className="thread-context">{hasProjectSlot && <span ref={projectSlot} className="thread-project-slot"><ProjectIcon project={project!} /></span>}{thread.worktree && !launching && !failed && <GitBranch className="thread-worktree" size={11} aria-label="Worktree" />}<span className="thread-context-text">{context}</span></span>{editor ?? <span className="thread-name">{displayTitle}</span>}</span>
    <span className="thread-time">{relativeTime(thread.updatedAt)}</span>
  </Row></Tooltip>;
}

function ProjectGroupHeader({ project, closed, onToggle, machine, onNavigate, metadata, metadataFields = {} }: { project: Project; closed: boolean; onToggle: () => void; machine?: Machine; onNavigate?: AppNavigate; metadata?: PendingMetadataController; metadataFields?: Record<string, MetadataFieldSnapshot> }) {
  const [renaming, setRenaming] = useState(false);
  const [changingIcon, setChangingIcon] = useState(false);
  const [terminalBusy, setTerminalBusy] = useState(false);
  const field = metadataFields[projectNameFieldKey(project)];
  const tickets = useThreadTickets();
  const openTerminalHere = async () => {
    if (!machine || !machine.connected || !machine.writable || terminalBusy) return;
    setTerminalBusy(true);
    try { await openTerminalTab(machine, project.path, undefined, tickets, onNavigate ?? (() => {})); }
    catch (error) { reportFailure(error); }
    finally { setTerminalBusy(false); }
  };
  const Title = renaming ? 'div' : 'button';
  const label = renaming ? <ProjectNameEditor project={project} machineName={machine?.name} onDone={() => setRenaming(false)} onError={reportFailure} metadata={metadata} metadataFields={metadataFields} /> : <span className="group-name">{project.name}</span>;
  const reconcileName = () => { if (metadata) void metadata.reconcileProject(project).catch(reportFailure); };
  const resaveName = async () => {
    if (!metadata || field?.status !== 'draft' || typeof field.draftValue !== 'string') return;
    if (await confirmDialog(resaveMetadataWarning, { confirmLabel: 'Re-save anyway' })) void metadata.renameProject(project, field.draftValue, true).catch(reportFailure);
  };
  return <><ContextMenu.Root>
    <ContextMenu.Trigger className="group-header">
      <Title className="group-title" onClick={renaming ? undefined : onToggle} aria-expanded={renaming ? undefined : !closed}>
        <span className="group-chevron" aria-hidden="true">{closed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</span><ProjectIcon project={project} />{label}
      </Title>
    </ContextMenu.Trigger>
    <ContextMenu.Portal><ContextMenu.Positioner className="thread-menu-positioner"><ContextMenu.Popup className="thread-menu">
      <ContextMenu.Item className="thread-menu-item" onClick={() => onNavigate?.(`/new?project=${encodeURIComponent(project.id)}`)}><Plus size={14} aria-hidden="true" />New thread</ContextMenu.Item>
      <ContextMenu.Item className="thread-menu-item" disabled={!machine || !machine.connected || !machine.writable || terminalBusy} onClick={() => void openTerminalHere()}><SquareTerminal size={14} aria-hidden="true" />New Terminal</ContextMenu.Item>
      <ContextMenu.Item className="thread-menu-item" onClick={() => setRenaming(true)}><Pencil size={14} aria-hidden="true" />Rename project on {machine?.name ?? project.machineId ?? 'local'}</ContextMenu.Item>
      <ContextMenu.Item className="thread-menu-item" onClick={() => setChangingIcon(true)}><ImageUp size={14} aria-hidden="true" />Change icon</ContextMenu.Item>
      <div className="thread-menu-path" title={project.path}>{withTildeHome(project.path)}</div>
    </ContextMenu.Popup></ContextMenu.Positioner></ContextMenu.Portal>
  </ContextMenu.Root>
  <MetadataFeedback label="project name" field={field} onReconcile={field?.status === 'uncertain' ? reconcileName : undefined} onEdit={field?.status === 'draft' ? () => setRenaming(true) : undefined} onResave={field?.status === 'draft' ? () => void resaveName() : undefined} />
  <ProjectIconDialog project={project} open={changingIcon} onClose={() => setChangingIcon(false)} onError={reportFailure} /></>;
}

function ArchivedThreads({ threads, renderThread }: { threads: Thread[]; renderThread: (thread: Thread) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deleteAll = async () => {
    if (!await confirmDialog(deleteArchivedWarning(threads), { confirmLabel: 'Delete all', danger: true })) return;
    setDeleting(true);
    try {
      const result = await deleteArchivedThreads();
      const issues: string[] = [];
      if (result.failed.length) issues.push(`${result.failed.length} item${result.failed.length === 1 ? '' : 's'} could not be deleted.`);
      if (result.skippedMachines.length) issues.push(`Orphan cleanup could not run on ${result.skippedMachines.length} machine${result.skippedMachines.length === 1 ? '' : 's'}.`);
      if (issues.length) await alertDialog(issues.join(' '));
    }
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

function DetachedThreads({ threads, renderThread }: { threads: Thread[]; renderThread: (thread: Thread) => ReactNode }) {
  const [open, setOpen] = useState(false);
  return <section className="thread-group archived-threads" aria-label="Detached threads">
    <div className="group-header">
      <button className="group-title" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span className="group-chevron" aria-hidden="true">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span><Unplug size={14} aria-hidden="true" /><span className="group-name">Detached</span><span className="group-count">{threads.length}</span>
      </button>
    </div>
    {open && threads.map(renderThread)}
  </section>;
}

export function Sidebar({ projects, threads, archived = [], floating = [], detached = [], ownedTabs = new Map(), machines, currentId, currentMachineId, currentTab, mode, onModeChange, collapsed, mobileOpen, onCollapse, onCloseMobile, onNavigate, onOpenPalette, paletteShortcut = 'meta+k', updateAction, metadata, metadataFields = {} }: Props) {
  const [closedProjects, setClosedProjects] = useState<string[]>([]);
  const [collapseMotionVersion, setCollapseMotionVersion] = useState(0);
  useEffect(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(closedProjectsStorageKey) ?? '[]');
      if (Array.isArray(stored)) setClosedProjects(stored.filter((id): id is string => typeof id === 'string'));
    } catch {}
  }, []);
  const toggleProject = (id: string) => {
    const next = closedProjects.includes(id) ? closedProjects.filter((item) => item !== id) : [...closedProjects, id];
    setClosedProjects(next);
    setCollapseMotionVersion((version) => version + 1);
    try { localStorage.setItem(closedProjectsStorageKey, JSON.stringify(next)); } catch {}
  };
  const currentProjectId = threads.find((thread) => thread.id === currentId && thread.machineId === currentMachineId)?.projectId;
  const projectGroups = groupProjectLocations(projects, currentProjectId);
  const terminalMachine = selectTerminalMachine(machines, currentMachineId);
  const [monitorBusy, setMonitorBusy] = useState(false);
  const monitorBusyRef = useRef(false);
  const tickets = useThreadTickets();
  const openResourceMonitor = async () => {
    const machine = terminalMachine;
    if (!machine || !machine.connected || !machine.writable || monitorBusyRef.current) return;
    monitorBusyRef.current = true;
    setMonitorBusy(true);
    try { await openTerminalTab(machine, '~/', 'resource-monitor', tickets, onNavigate ?? (() => {})); }
    catch (error) { reportFailure(error); }
    finally { monitorBusyRef.current = false; setMonitorBusy(false); }
  };
  const navigation = useRef<HTMLElement>(null);
  useFlipList(navigation, collapseMotionVersion);
  const pinnedKeys = usePinnedKeys();
  const orderedThreads = useMemo(() => pinnedFirst(threads, pinnedKeys), [threads, pinnedKeys]);
  const [drag, setDrag] = useState<PinDragState>();
  const dragKey = useRef<string>();
  const pinDrag = useMemo<PinDrag>(() => ({
    active: () => dragKey.current !== undefined,
    start: (key) => { dragKey.current = key; setDrag({ key }); },
    over: (key, edge) => setDrag((current) => !current || current.key === key || current.target?.key === key && current.target.edge === edge ? current : { ...current, target: { key, edge } }),
    drop: (key, edge) => { if (dragKey.current) movePin(dragKey.current, key, edge); },
    end: () => { dragKey.current = undefined; setDrag(undefined); },
  }), []);
  const threadLink = (thread: Thread, showProject: boolean, pinnable = true) => {
    const key = pinKey(thread);
    const project = projects.find((item) => (item.machineId ?? 'local') === thread.machineId && item.id === thread.projectId);
    const ownedTab = ownedTabs.get(thread.id);
    const machine = machines.find((item) => item.id === thread.machineId);
    const href = ownedTab ? terminalHref(ownedTab.session || machine?.session || 'default', ownedTab) : `/threads/${encodeURIComponent(thread.id)}`;
    const viewingOwnedTab = !!ownedTab && currentTab?.machineId === ownedTab.machineId && currentTab?.tabId === ownedTab.tabId;
    const keyed = ownedTab || thread.bindingState === 'attached' && thread.tabId;
    const connected = machine?.connected === true;
    return <ThreadRow key={keyed ? sidebarTabKey(thread.machineId, ownedTab?.tabId ?? thread.tabId) : JSON.stringify([thread.machineId, thread.id])} thread={thread} project={project} machineName={machine?.name ?? thread.machineId} current={currentId === thread.id && currentMachineId === thread.machineId || viewingOwnedTab} showProject={showProject} href={href} connected={connected} canDelete={connected} pinnable={pinnable} pinned={pinnable && pinnedKeys.includes(key)} pinDrag={pinDrag} dragging={drag?.key === key} dropEdge={drag?.target?.key === key ? drag.target.edge : undefined} metadata={metadata} metadataFields={metadataFields} />;
  };
  const terminalLink = (tab: FloatingTab) => {
    const machine = machines.find((item) => item.id === tab.machineId);
    const session = tab.session || machine?.session || 'default';
    const canClose = !!machine?.connected && !!machine?.writable;
    return <TerminalRow key={sidebarTabKey(tab.machineId, tab.tabId)} tab={tab} session={session} machineName={machine?.name ?? tab.machineId} current={currentTab?.machineId === tab.machineId && currentTab?.tabId === tab.tabId} canClose={canClose} />;
  };
  const terminalsDivider = !!floating.length && <div className="thread-group" aria-label="Terminals"><div className="group-header"><span className="group-title"><SquareTerminal size={14} aria-hidden="true" /><span className="group-name">Terminals</span><span className="group-count">{floating.length}</span></span></div></div>;

  return <>
    {mobileOpen && <button className="sidebar-scrim" aria-label="Close sidebar" onClick={onCloseMobile} />}
    <aside className={`sidebar ${collapsed ? 'is-collapsed' : ''} ${mobileOpen ? 'is-mobile-open' : ''}`} aria-label="Threads"
      onClick={(event) => { if (mobileOpen && (event.target as Element).closest('a[href]')) onCloseMobile(); }}>
      <div className="sidebar-header">
        {!collapsed && <><span className="brand"><img src="/brand-mark.png" alt="" width={20} height={20} />webr</span><SidebarMetrics disabled={!terminalMachine || monitorBusy} onOpenMonitor={() => void openResourceMonitor()} /></>}
        <button className="icon-button sidebar-collapse" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={onCollapse}>{collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}</button>
        <button className="icon-button mobile-close" aria-label="Close sidebar" onClick={onCloseMobile}><X size={16} /></button>
      </div>
      <div className="sidebar-actions">
        <Tooltip label="New thread"><a className="sidebar-new-thread" href={`/new${currentProjectId ? `?project=${encodeURIComponent(currentProjectId)}` : ''}`} aria-label="New thread">
          <SquarePen size={16} aria-hidden="true" />
        </a></Tooltip>
        <NewTerminalButton machine={terminalMachine} onNavigate={onNavigate} />
        <OpenWorktree projects={projects} onNavigate={onNavigate} />
        {!collapsed && <div className="sidebar-view-switch" role="group" aria-label="Sidebar layout">
          <Tooltip label="Show threads"><button type="button" aria-label="Show threads" aria-pressed={mode === 'threads'} onClick={() => onModeChange('threads')}><LayoutList size={16} aria-hidden="true" /></button></Tooltip>
          <Tooltip label="Group by project"><button type="button" aria-label="Group by project" aria-pressed={mode === 'projects'} onClick={() => onModeChange('projects')}><FolderTree size={16} aria-hidden="true" /></button></Tooltip>
        </div>}
      </div>
      {!collapsed && <>
        <nav ref={navigation} className="thread-navigation" aria-label="Agent threads" data-sidebar-navigation="true">
          {mode === 'projects' ? <>{projectGroups.filter((group) => threads.some((thread) => group.locations.includes(thread.projectId))).sort((a, b) => (threads.find((thread) => b.locations.includes(thread.projectId))?.updatedAt ?? '').localeCompare(threads.find((thread) => a.locations.includes(thread.projectId))?.updatedAt ?? '')).map(({ id, project, locations }) => <section key={id} className="thread-group">
            <ProjectGroupHeader project={project} machine={machines.find((machine) => machine.id === (project.machineId ?? 'local'))} closed={closedProjects.includes(id)} onToggle={() => toggleProject(id)} onNavigate={onNavigate} metadata={metadata} metadataFields={metadataFields} />
            {!closedProjects.includes(id) && orderedThreads.filter((thread) => locations.includes(thread.projectId)).map((thread) => threadLink(thread, false))}
          </section>)}{terminalsDivider}{floating.map(terminalLink)}</> : <>{orderedThreads.map((thread) => threadLink(thread, true))}{terminalsDivider}{floating.map(terminalLink)}</>}
          {!threads.length && !floating.length && !archived.length && !detached.length && <p className="sidebar-empty">No agents or terminals yet. Press {formatShortcut(paletteShortcut)} to start one.</p>}
        </nav>
        {!!detached.length && <DetachedThreads threads={detached} renderThread={(thread) => threadLink(thread, true, false)} />}
        {!!archived.length && <ArchivedThreads threads={archived} renderThread={(thread) => threadLink(thread, true, false)} />}
        <div className="sidebar-footer">
          <a className="sidebar-settings" href="/settings"><Settings2 size={15} /> Settings</a>
          {updateAction}
          <Tooltip label={`Open command palette (${formatShortcut(paletteShortcut)})`}><button type="button" className="sidebar-palette" aria-label={`Open command palette (${formatShortcut(paletteShortcut)})`} onClick={onOpenPalette}><Command size={15} aria-hidden="true" /></button></Tooltip>
        </div>
      </>}
    </aside>
  </>;
}
