import { alertDialog, confirmDialog } from './dialogs';
import { Tooltip } from './Tooltip';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ThreadAvatar } from './ThreadAvatar';
import { Archive, ArchiveRestore, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Copy, FolderTree, Gauge, LayoutList, Monitor, Moon, PanelLeft, Pencil, Settings2, SquarePen, SquareTerminal, Sun, TerminalSquare, X } from 'lucide-react';
import type { Project, Thread } from '../lib/models';
import type { FloatingTab } from '../lib/floating';
import { defaultShortcuts, formatShortcut, loadShortcuts, type ShortcutAction } from './shortcuts';
import type { SidebarMode } from './Sidebar';
import { applyTheme } from './ThemeControl';
import { navigate } from 'astro:transitions/client';
import { requestThreadRename } from '../client/keyboard';
import { setThreadArchived } from '../client/thread-actions';
import { canClosePane } from '../lib/pane-strip';
import { perfAvailable, perfVisible, setPerfVisible } from '../client/perf';

const reportFailure = (error: unknown) => alertDialog(error instanceof Error ? error.message : 'Herdr could not complete this action.');

type Command = { label: string; icon: ReactNode; detail?: string; shortcut?: ShortcutAction; keywords?: string; run: () => void };

export function CommandPalette({ open, onClose, projects, threads, floating = [], machines = [], thread, focusedPane, mode, onModeChange, onToggleSidebar, onFocusPane, onTerminalAction, onOpenTerminal, onNewTerminal, onOpenResourceMonitor, onClosePane }: {
  open: boolean; onClose: () => void; projects: Project[]; threads: Thread[]; floating?: FloatingTab[]; machines?: { id: string; name: string; session: string }[]; thread?: Thread;
  focusedPane: string; mode: SidebarMode; onModeChange: (mode: SidebarMode) => void;
  onToggleSidebar: () => void; onFocusPane: (paneId: string) => void;
  onTerminalAction: (action: 'control' | 'takeover' | 'release') => void;
  onOpenTerminal: () => void; onNewTerminal?: () => void | Promise<void>; onOpenResourceMonitor?: () => void | Promise<void>; onClosePane: () => void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [shortcuts, setShortcuts] = useState(defaultShortcuts);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery(''); setSelected(0);
    void loadShortcuts().then((next) => setShortcuts(next));
    requestAnimationFrame(() => input.current?.focus());
  }, [open]);

  const navigateThread = (offset: number) => {
    const index = threads.findIndex((item) => item.id === thread?.id);
    const start = index === -1 && offset < 0 ? 0 : index;
    const target = threads[(start + offset + threads.length) % threads.length];
    if (target) void navigate(`/threads/${encodeURIComponent(target.id)}`);
  };
  const focusPane = (offset: number) => {
    if (thread?.panes.length) onFocusPane(thread.panes[(thread.panes.findIndex((pane) => pane.id === focusedPane) + offset + thread.panes.length) % thread.panes.length].id);
  };

  const commands = useMemo<Command[]>(() => [
    { label: 'New thread', icon: <SquarePen size={16} />, shortcut: 'newThread', run: () => { void navigate(`/new${thread ? `?project=${encodeURIComponent(thread.projectId)}` : ''}`); } },
    ...(onNewTerminal ? [{ label: 'New Terminal', icon: <SquareTerminal size={16} />, keywords: 'new shell', run: () => { void onNewTerminal(); } }] : []),
    ...(onOpenResourceMonitor ? [{ label: 'Open Resource Monitor', icon: <Gauge size={16} />, keywords: 'cpu ram memory', run: () => { void onOpenResourceMonitor(); } }] : []),
    { label: 'Settings', icon: <Settings2 size={16} />, run: () => { void navigate('/settings'); } },
    ...(perfAvailable ? [{ label: 'Toggle performance overlay', icon: <Gauge size={16} />, detail: 'Dev only', run: () => setPerfVisible(!perfVisible()) }] : []),
    { label: 'Toggle sidebar', icon: <PanelLeft size={16} />, shortcut: 'toggleSidebar', keywords: 'panel', run: onToggleSidebar },
    ...(threads.length ? [
      { label: 'Next thread', icon: <ArrowDown size={16} />, shortcut: 'nextThread' as const, run: () => navigateThread(1) },
      { label: 'Previous thread', icon: <ArrowUp size={16} />, shortcut: 'previousThread' as const, run: () => navigateThread(-1) },
    ] : []),
    { label: 'Group threads by project', icon: <FolderTree size={16} />, detail: mode === 'projects' ? 'Selected' : undefined, run: () => onModeChange('projects') },
    { label: 'Show all threads', icon: <LayoutList size={16} />, detail: mode === 'threads' ? 'Selected' : undefined, run: () => onModeChange('threads') },
    ...(['system', 'light', 'dark'] as const).map((theme) => ({
      label: `${theme[0].toUpperCase()}${theme.slice(1)} theme`,
      icon: theme === 'system' ? <Monitor size={16} /> : theme === 'light' ? <Sun size={16} /> : <Moon size={16} />,
      run: () => { localStorage.setItem('webr-theme', theme); applyTheme(theme); window.dispatchEvent(new Event('webr-theme-change')); },
    })),
    ...(thread ? [
      { label: thread.archivedAt ? 'Unarchive thread' : 'Archive thread', icon: thread.archivedAt ? <ArchiveRestore size={16} /> : <Archive size={16} />, run: () => { void setThreadArchived(thread, !thread.archivedAt).catch(reportFailure); } },
      { label: 'Copy thread link', icon: <Copy size={16} />, keywords: 'url', run: () => { void navigator.clipboard.writeText(location.href); } },
      { label: 'Rename thread', icon: <Pencil size={16} />, shortcut: 'renameThread' as const, keywords: 'tab title', run: () => requestThreadRename(thread.id) },
      ...(thread.bindingState === 'attached' ? [
        { label: 'New split', icon: <SquareTerminal size={16} />, shortcut: 'openTerminal' as const, keywords: 'new pane terminal', run: onOpenTerminal },
        ...(canClosePane(thread, focusedPane) ? [{ label: 'Close pane', icon: <X size={16} />, shortcut: 'closePane' as const, keywords: 'kill terminal', run: onClosePane }] : []),
      ] : []),
      ...(thread.bindingState === 'attached' ? [
        { label: 'Request terminal control', icon: <TerminalSquare size={16} />, run: () => onTerminalAction('control') },
        { label: 'Release terminal control', icon: <TerminalSquare size={16} />, run: () => onTerminalAction('release') },
        { label: 'Take over terminal control', icon: <TerminalSquare size={16} />, run: () => { void confirmDialog('Replace the active controller of this terminal?', { confirmLabel: 'Take over' }).then((accepted) => { if (accepted) onTerminalAction('takeover'); }); } },
      ] : []),
      { label: 'Next pane', icon: <ArrowRight size={16} />, shortcut: 'nextPane' as const, run: () => focusPane(1) },
      { label: 'Previous pane', icon: <ArrowLeft size={16} />, shortcut: 'previousPane' as const, run: () => focusPane(-1) },
       ...thread.panes.map((pane, index) => ({ label: `Focus ${pane.title}`, icon: <TerminalSquare size={16} />, detail: `Pane ${index + 1}`, run: () => onFocusPane(pane.id) })),
    ] : []),
    ...threads.map((item) => ({ label: item.title, icon: <ThreadAvatar thread={item} working={item.status === 'working'} size={22} />, detail: projects.find((project) => project.id === item.projectId)?.name,
      run: () => { void navigate(`/threads/${encodeURIComponent(item.id)}`); } })),
    ...floating.map((item) => {
      const machine = machines.find((entry) => entry.id === item.machineId);
      const session = item.session || machine?.session || 'default';
      return { label: item.label, icon: <SquareTerminal size={16} />, detail: `${machine?.name ?? item.machineId} · Terminal`,
        run: () => { void navigate(`/sessions/${encodeURIComponent(session)}/tabs/${encodeURIComponent(item.tabId)}?machine=${encodeURIComponent(item.machineId)}`); } };
    }),
  ], [projects, threads, floating, machines, thread, focusedPane, mode, onModeChange, onToggleSidebar, onFocusPane, onTerminalAction, onOpenTerminal, onNewTerminal, onOpenResourceMonitor, onClosePane]);

  const matching = commands.filter((command) => `${command.label} ${command.detail ?? ''} ${command.keywords ?? ''}`.toLowerCase().includes(query.toLowerCase().trim()));
  if (!open) return null;

  const run = (command: Command) => { onClose(); command.run(); };
  return <div className="palette-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key === 'ArrowDown') { event.preventDefault(); setSelected((value) => (value + 1) % (matching.length || 1)); }
      if (event.key === 'ArrowUp') { event.preventDefault(); setSelected((value) => (value - 1 + (matching.length || 1)) % (matching.length || 1)); }
      if (event.key === 'Enter' && matching.length) { event.preventDefault(); run(matching[Math.min(selected, matching.length - 1)]); }
      if (event.key === 'Tab') { event.preventDefault(); input.current?.focus(); }
    }}>
      <input ref={input} aria-label="Search commands and threads" placeholder="Search threads and actions…" value={query} onChange={(event) => { setQuery(event.target.value); setSelected(0); }} />
      <div className="palette-results" role="listbox" aria-label="Results">
        {matching.map((command, index) => <button role="option" aria-selected={selected === index} className={selected === index ? 'is-selected' : ''} key={`${command.label}-${index}`} onMouseEnter={() => setSelected(index)} onClick={() => run(command)}>
          <span className="palette-icon" aria-hidden="true">{command.icon}</span><span className="palette-label">{command.label}</span>{command.detail && <small>{command.detail}</small>}{command.shortcut && <Tooltip label={formatShortcut(shortcuts[command.shortcut])}><kbd>{formatShortcut(shortcuts[command.shortcut])}</kbd></Tooltip>}
        </button>)}
        {!matching.length && <p>No results</p>}
      </div>
      <div className="palette-help">↑↓ Navigate <span>↵ Select</span> <span>Esc Close</span></div>
    </div>
  </div>;
}
