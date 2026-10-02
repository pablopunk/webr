import { confirmDialog } from './dialogs';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BotAvatar } from 'bot-avatars';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Copy, FolderTree, LayoutList, Monitor, Moon, PanelBottom, PanelLeft, PanelRight, Plus, Settings2, SquareTerminal, Sun, TerminalSquare, X } from 'lucide-react';
import { avatarForThread } from '../lib/avatars';
import type { Project, Thread } from '../lib/models';
import { defaultShortcuts, formatShortcut, getShortcuts, type ShortcutAction } from './shortcuts';
import type { SidebarMode } from './Sidebar';
import { applyTheme } from './ThemeControl';
import { navigate } from 'astro:transitions/client';
import type { TerminalDirection } from '../client/thread-actions';
import { threadShell } from '../lib/terminal-split';

type Command = { label: string; icon: ReactNode; detail?: string; shortcut?: ShortcutAction; run: () => void };

export function CommandPalette({ open, onClose, projects, threads, thread, focusedPane, mode, onModeChange, onToggleSidebar, onFocusPane, onTerminalAction, onToggleTerminal, onCloseTerminal }: {
  open: boolean; onClose: () => void; projects: Project[]; threads: Thread[]; thread?: Thread;
  focusedPane: string; mode: SidebarMode; onModeChange: (mode: SidebarMode) => void;
  onToggleSidebar: () => void; onFocusPane: (paneId: string) => void;
  onTerminalAction: (action: 'control' | 'takeover' | 'release') => void;
  onToggleTerminal: (direction?: TerminalDirection) => void; onCloseTerminal: () => void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [shortcuts, setShortcuts] = useState(defaultShortcuts);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery(''); setSelected(0);
    setShortcuts(getShortcuts());
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
    { label: 'New thread', icon: <Plus size={16} />, shortcut: 'newThread', run: () => { void navigate(`/new${thread ? `?project=${encodeURIComponent(thread.projectId)}` : ''}`); } },
    { label: 'Settings', icon: <Settings2 size={16} />, run: () => { void navigate('/settings'); } },
    { label: 'Toggle sidebar', icon: <PanelLeft size={16} />, shortcut: 'toggleSidebar', run: onToggleSidebar },
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
      { label: 'Copy thread link', icon: <Copy size={16} />, run: () => { void navigator.clipboard.writeText(location.href); } },
      ...(thread.bindingState === 'attached' ? threadShell(thread) ? [
        { label: 'Toggle terminal', icon: <SquareTerminal size={16} />, shortcut: 'toggleTerminal' as const, run: () => onToggleTerminal() },
        { label: 'Close terminal', icon: <X size={16} />, detail: 'Stops its shell', run: onCloseTerminal },
      ] : [
        { label: 'Toggle terminal (side)', icon: <PanelRight size={16} />, shortcut: 'toggleTerminal' as const, run: () => onToggleTerminal('right') },
        { label: 'Toggle terminal (below)', icon: <PanelBottom size={16} />, run: () => onToggleTerminal('down') },
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
    ...threads.map((item) => ({ label: item.title, icon: <BotAvatar {...avatarForThread(item)} size={22} state={item.status === 'working' ? 'working' : 'default'} paused={item.status !== 'working'} />, detail: projects.find((project) => project.id === item.projectId)?.name,
      run: () => { void navigate(`/threads/${encodeURIComponent(item.id)}`); } })),
  ], [projects, threads, thread, focusedPane, mode, onModeChange, onToggleSidebar, onFocusPane, onTerminalAction, onToggleTerminal, onCloseTerminal]);

  const matching = commands.filter((command) => `${command.label} ${command.detail ?? ''}`.toLowerCase().includes(query.toLowerCase().trim()));
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
          <span className="palette-icon" aria-hidden="true">{command.icon}</span><span className="palette-label">{command.label}</span>{command.detail && <small>{command.detail}</small>}{command.shortcut && <kbd title={shortcuts[command.shortcut]}>{formatShortcut(shortcuts[command.shortcut])}</kbd>}
        </button>)}
        {!matching.length && <p>No results</p>}
      </div>
      <div className="palette-help">↑↓ Navigate <span>↵ Select</span> <span>Esc Close</span></div>
    </div>
  </div>;
}
