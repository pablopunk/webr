import { useEffect, useState } from 'react';
import { HomeView } from './HomeView';
import { NewThreadView } from './NewThreadView';
import { SettingsView } from './SettingsView';
import { Sidebar } from './Sidebar';
import { ThreadView } from './ThreadView';
import { getShortcuts, keyCombo } from './shortcuts';
import type { Project, Thread } from '../lib/models';

type Props = {
  page: 'home' | 'thread' | 'new' | 'settings' | 'missing';
  projects: Project[];
  threads: Thread[];
  thread?: Thread;
  projectId?: string;
};

export default function App({ page, projects, threads, thread, projectId }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [focusedPane, setFocusedPane] = useState(0);
  const project = projects.find((item) => item.id === thread?.projectId);

  useEffect(() => { setCollapsed(localStorage.getItem('herdr-sidebar-collapsed') === 'true'); }, []);

  const toggleSidebar = () => {
    if (window.matchMedia('(max-width: 760px)').matches) { setMobileOpen((value) => !value); return; }
    setCollapsed((value) => {
      localStorage.setItem('herdr-sidebar-collapsed', String(!value));
      return !value;
    });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('.shortcut-key')) return;
      if (target?.closest('input, textarea, select, [contenteditable="true"]') && !target.closest('.xterm')) return;
      const action = Object.entries(getShortcuts()).find(([, combo]) => combo === keyCombo(event))?.[0];
      if (!action) return;
      event.preventDefault();
      if (action === 'toggleSidebar') toggleSidebar();
      if (action === 'newThread') location.assign(`/new${thread ? `?project=${encodeURIComponent(thread.projectId)}` : ''}`);
      if (action === 'nextPane' && thread) setFocusedPane((index) => (index + 1) % thread.panes.length);
      if (action === 'previousPane' && thread) setFocusedPane((index) => (index - 1 + thread.panes.length) % thread.panes.length);
      if (action === 'nextThread' || action === 'previousThread') {
        const index = threads.findIndex((item) => item.id === thread?.id);
        const next = action === 'nextThread' ? (index + 1) % threads.length : (index - 1 + threads.length) % threads.length;
        if (threads[next]) location.assign(`/threads/${encodeURIComponent(threads[next].id)}`);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [thread, threads, collapsed, mobileOpen]);

  return <div className={`app-shell ${collapsed ? 'sidebar-is-collapsed' : ''}`}>
    <Sidebar projects={projects} threads={threads} currentId={thread?.id} collapsed={collapsed}
      mobileOpen={mobileOpen} onCollapse={toggleSidebar} onCloseMobile={() => setMobileOpen(false)} />
    <div className="main-panel">
      {page === 'home' && <HomeView projects={projects} threads={threads} onOpenSidebar={toggleSidebar} />}
      {page === 'thread' && thread && project && <ThreadView thread={thread} project={project} onOpenSidebar={toggleSidebar} focusedPane={focusedPane} onFocusPane={setFocusedPane} />}
      {page === 'new' && <NewThreadView projects={projects} selectedProjectId={projectId} onOpenSidebar={toggleSidebar} />}
      {page === 'settings' && <SettingsView onOpenSidebar={toggleSidebar} />}
      {page === 'missing' && <main className="not-found"><span className="eyebrow">404 / NOT FOUND</span><h1>This thread is not here.</h1><p>It may have moved or closed.</p><a href="/" className="primary-button">Back to threads</a></main>}
    </div>
  </div>;
}
