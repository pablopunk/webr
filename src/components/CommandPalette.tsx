import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BotAvatar } from 'bot-avatars';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Copy, FolderTree, LayoutList, Monitor, Moon, PanelLeft, Plus, Settings2, Sun, TerminalSquare } from 'lucide-react';
import { avatarForThread } from '../lib/avatars';
import type { Project, Thread } from '../lib/models';
import { defaultShortcuts, formatShortcut, getShortcuts, type ShortcutAction } from './shortcuts';
import type { SidebarMode } from './Sidebar';
import { applyTheme } from './ThemeControl';

type Command = { label: string; icon: ReactNode; detail?: string; shortcut?: ShortcutAction; run: () => void };

export function CommandPalette({ open, onClose, projects, threads, thread, focusedPane, mode, onModeChange, onToggleSidebar, onFocusPane }: {
  open: boolean; onClose: () => void; projects: Project[]; threads: Thread[]; thread?: Thread;
  focusedPane: number; mode: SidebarMode; onModeChange: (mode: SidebarMode) => void;
  onToggleSidebar: () => void; onFocusPane: (index: number) => void;
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
    if (target) location.assign(`/threads/${encodeURIComponent(target.id)}`);
  };
  const focusPane = (offset: number) => {
    if (thread?.panes.length) onFocusPane((focusedPane + offset + thread.panes.length) % thread.panes.length);
  };

  const commands = useMemo<Command[]>(() => [
    { label: 'New thread', icon: <Plus size={16} />, shortcut: 'newThread', run: () => location.assign(`/new${thread ? `?project=${encodeURIComponent(thread.projectId)}` : ''}`) },
    { label: 'Settings', icon: <Settings2 size={16} />, run: () => location.assign('/settings') },
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
      run: () => { localStorage.setItem('herdr-theme', theme); applyTheme(theme); window.dispatchEvent(new Event('herdr-theme-change')); },
    })),
    ...(thread ? [
      { label: 'Copy thread link', icon: <Copy size={16} />, run: () => { void navigator.clipboard.writeText(location.href); } },
      { label: 'Next pane', icon: <ArrowRight size={16} />, shortcut: 'nextPane' as const, run: () => focusPane(1) },
      { label: 'Previous pane', icon: <ArrowLeft size={16} />, shortcut: 'previousPane' as const, run: () => focusPane(-1) },
      ...thread.panes.map((pane, index) => ({ label: `Focus ${pane.title}`, icon: <TerminalSquare size={16} />, detail: `Pane ${index + 1}`, run: () => onFocusPane(index) })),
    ] : []),
    ...threads.map((item) => ({ label: item.title, icon: <BotAvatar {...avatarForThread(item)} size={22} state={item.status === 'working' ? 'working' : 'default'} paused={item.status !== 'working'} />, detail: projects.find((project) => project.id === item.projectId)?.name,
      run: () => location.assign(`/threads/${encodeURIComponent(item.id)}`) })),
  ], [projects, threads, thread, focusedPane, mode, onModeChange, onToggleSidebar, onFocusPane]);

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
