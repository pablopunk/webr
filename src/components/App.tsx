import { useCallback, useEffect, useState } from 'react';
import { PanelLeft, Search } from 'lucide-react';
import { CommandPalette } from './CommandPalette';
import { NewThreadView } from './NewThreadView';
import { SettingsView } from './SettingsView';
import { Sidebar, type SidebarMode } from './Sidebar';
import { applyTheme } from './ThemeControl';
import { ThreadView } from './ThreadView';
import { getShortcuts, keyCombo } from './shortcuts';
import type { Project, Thread } from '../lib/models';

type Props = {
  page: 'thread' | 'new' | 'settings' | 'missing';
  projects: Project[];
  threads: Thread[];
  thread?: Thread;
  projectId?: string;
};

export default function App({ page, projects, threads, thread, projectId }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mode, setMode] = useState<SidebarMode>('threads');
  const [focusedPane, setFocusedPane] = useState(0);

  useEffect(() => {
    setCollapsed(localStorage.getItem('herdr-sidebar-collapsed') === 'true');
    setMode(localStorage.getItem('herdr-sidebar-mode') === 'projects' ? 'projects' : 'threads');
    const media = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => { if ((localStorage.getItem('herdr-theme') ?? 'system') === 'system') applyTheme('system'); };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const toggleSidebar = useCallback(() => {
    if (window.matchMedia('(max-width: 760px)').matches) { setMobileOpen((value) => !value); return; }
    setCollapsed((value) => { localStorage.setItem('herdr-sidebar-collapsed', String(!value)); return !value; });
  }, []);

  const changeMode = useCallback((value: SidebarMode) => {
    setMode(value);
    localStorage.setItem('herdr-sidebar-mode', value);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-recording="true"]')) return;
      if (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault(); setPaletteOpen((value) => !value); return;
      }
      if (paletteOpen || event.defaultPrevented) return;
      if (target?.closest('input, textarea, select, [contenteditable="true"]') && !target.closest('.xterm')) return;
      const action = Object.entries(getShortcuts()).find(([, combo]) => combo === keyCombo(event))?.[0];
      if (!action) return;
      event.preventDefault();
      if (action === 'toggleSidebar') toggleSidebar();
      if (action === 'newThread') location.assign(`/new${thread ? `?project=${encodeURIComponent(thread.projectId)}` : ''}`);
      if (action === 'nextPane' && thread) setFocusedPane((index) => (index + 1) % thread.panes.length);
      if (action === 'previousPane' && thread) setFocusedPane((index) => (index - 1 + thread.panes.length) % thread.panes.length);
      if ((action === 'nextThread' || action === 'previousThread') && threads.length) {
        const index = threads.findIndex((item) => item.id === thread?.id);
        const next = action === 'nextThread' ? (index + 1) % threads.length : (index - 1 + threads.length) % threads.length;
        location.assign(`/threads/${encodeURIComponent(threads[next].id)}`);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [thread, threads, paletteOpen, toggleSidebar]);

  return <div className="app-shell">
    <Sidebar projects={projects} threads={threads} currentId={thread?.id} mode={mode} collapsed={collapsed}
      mobileOpen={mobileOpen} onCollapse={toggleSidebar} onCloseMobile={() => setMobileOpen(false)} />
    <div className="main-panel">
      {page === 'thread' && thread && <ThreadView thread={thread} focusedPane={focusedPane} onFocusPane={setFocusedPane} />}
      {page === 'new' && <NewThreadView projects={projects} selectedProjectId={projectId} onOpenSidebar={toggleSidebar} />}
      {page === 'settings' && <SettingsView onOpenSidebar={toggleSidebar} mode={mode} onModeChange={changeMode} />}
      {page === 'missing' && <main className="not-found"><h1>Thread not found</h1><a href="/">Open a thread</a></main>}
    </div>
    {page === 'thread' && <div className="mobile-controls"><button aria-label="Open sidebar" onClick={toggleSidebar}><PanelLeft size={16} /></button><button aria-label="Open command palette" onClick={() => setPaletteOpen(true)}><Search size={16} /></button></div>}
    <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} projects={projects} threads={threads} thread={thread} focusedPane={focusedPane}
      mode={mode} onModeChange={changeMode} onToggleSidebar={toggleSidebar} onFocusPane={setFocusedPane} />
  </div>;
}
