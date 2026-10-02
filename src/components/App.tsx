import { useCallback, useEffect, useRef, useState } from 'react';
import { PanelLeft, Search } from 'lucide-react';
import { CommandPalette } from './CommandPalette';
import { PerfOverlay } from './PerfOverlay';
import { PairingPrompt } from './PairingPrompt';
import { NewThreadView } from './NewThreadView';
import { SettingsView } from './SettingsView';
import { Sidebar, type SidebarMode } from './Sidebar';
import { applyTheme } from './ThemeControl';
import { ThreadView } from './ThreadView';
import { getShortcuts } from './shortcuts';
import { navigate } from 'astro:transitions/client';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from 'zustand';
import { RuntimeProvider, useRuntime, useRuntimeSelector } from '../client/provider';
import type { Bootstrap } from '../shared/runtime';
import { appShortcutAction } from '../client/keyboard';
import { perfAvailable, startPerf } from '../client/perf';
import { closeThreadTerminal, toggleThreadTerminal, type TerminalDirection } from '../client/thread-actions';
import { currentTerminalDirection, threadAgent, threadShell } from '../lib/terminal-split';
import { alertDialog } from './dialogs';
import { useClearDoneOnVisit } from '../client/clear-done-on-visit';
import { isListedThread } from '../lib/launch';
import { carriesFiles } from '../client/image-attach';

type Props = {
  page: 'thread' | 'new' | 'settings' | 'missing';
  bootstrap: Bootstrap;
  threadId?: string;
  projectId?: string;
};

export default function App(props: Props) {
  return <RuntimeProvider bootstrap={props.bootstrap}><RuntimeApp {...props} /></RuntimeProvider>;
}

function RuntimeApp({ page, bootstrap, threadId, projectId }: Props) {
  const { ui, terminals } = useRuntime();
  const projects = useRuntimeSelector(useShallow((state) => state.projectIds.map((id) => state.projects[id])));
  const threads = useRuntimeSelector(useShallow((state) => state.threadIds.map((id) => state.threads[id]).filter((item) => !item.archivedAt && isListedThread(item))));
  const archived = useRuntimeSelector(useShallow((state) => state.threadIds.map((id) => state.threads[id]).filter((item) => !!item.archivedAt)));
  const thread = useRuntimeSelector((state) => state.threads[threadId ?? '']);
  const projections = useRuntimeSelector((state) => state.projections);
  const gatewayConnected = useRuntimeSelector((state) => state.connected);
  const machines = Object.values(projections).flatMap((projection) => { const machine = projection.machine ?? bootstrap.machines.find((machine) => machine.id === projection.machineId); return machine ? [{ ...machine, connected: gatewayConnected && projection.connected, error: projection.error }] : []; });
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(startPerf, []);
  const [mode, setMode] = useState<SidebarMode>('threads');
  const scope = `${thread?.machineId ?? ''}:${thread?.id ?? ''}`;
  const storedFocus = useStore(ui, (state) => state.focusedPanes[scope]);
  const focusedPane = thread?.panes.some((pane) => pane.id === storedFocus) ? storedFocus! : thread?.panes[0]?.id ?? '';
  const setFocusedPane = useCallback((paneId: string) => ui.getState().focus(scope, paneId), [ui, scope]);
  useClearDoneOnVisit(page === 'thread' ? thread : undefined, focusedPane, gatewayConnected && !!machines.find((machine) => machine.id === thread?.machineId)?.writable);

  const shownThreadId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (thread) shownThreadId.current = thread.id;
    else if (page === 'thread' && shownThreadId.current === threadId) void navigate('/');
  }, [thread, page, threadId]);

  useEffect(() => {
    const keepFileDropsInsideTheApp = (event: DragEvent) => { if (carriesFiles(event.dataTransfer)) event.preventDefault(); };
    window.addEventListener('dragover', keepFileDropsInsideTheApp); window.addEventListener('drop', keepFileDropsInsideTheApp);
    return () => { window.removeEventListener('dragover', keepFileDropsInsideTheApp); window.removeEventListener('drop', keepFileDropsInsideTheApp); };
  }, []);

  useEffect(() => {
    const syncCollapsedFromUrl = () => setCollapsed(new URLSearchParams(window.location.search).get('sidebar') === 'collapsed');
    syncCollapsedFromUrl();
    window.addEventListener('popstate', syncCollapsedFromUrl);
    setMode(localStorage.getItem('webr-sidebar-mode') === 'projects' ? 'projects' : 'threads');
    const media = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => { if ((localStorage.getItem('webr-theme') ?? 'system') === 'system') applyTheme('system'); };
    media.addEventListener('change', onChange);
    return () => { media.removeEventListener('change', onChange); window.removeEventListener('popstate', syncCollapsedFromUrl); };
  }, []);

  const layouts = thread ? projections[thread.machineId]?.layouts ?? [] : [];
  const reportTerminalFailure = (error: unknown) => void alertDialog(error instanceof Error ? error.message : 'Herdr could not change the terminal.');
  const toggleTerminal = useCallback((direction?: TerminalDirection) => {
    if (!thread) return;
    const chosen = direction ?? currentTerminalDirection(thread, layouts, window.matchMedia('(max-width: 760px)').matches);
    void toggleThreadTerminal(thread, chosen).then(({ paneId, hidden }) => setFocusedPane(hidden ? threadAgent(thread)?.id ?? paneId : paneId), reportTerminalFailure);
  }, [thread, layouts, setFocusedPane]);
  const focusPane = useCallback((paneId: string) => {
    const hiddenShell = thread?.terminalHidden && threadShell(thread)?.id === paneId;
    if (hiddenShell) toggleTerminal(); else setFocusedPane(paneId);
  }, [thread, toggleTerminal, setFocusedPane]);
  const closeTerminal = useCallback(() => {
    if (!thread) return;
    void closeThreadTerminal(thread).then(() => { const agent = threadAgent(thread); if (agent) setFocusedPane(agent.id); }, reportTerminalFailure);
  }, [thread, setFocusedPane]);

  const toggleSidebar = useCallback(() => {
    if (window.matchMedia('(max-width: 760px)').matches) { setMobileOpen((value) => !value); return; }
    setCollapsed((value) => {
      const next = !value;
      const url = new URL(window.location.href);
      if (next) url.searchParams.set('sidebar', 'collapsed');
      else url.searchParams.delete('sidebar');
      window.history.replaceState(window.history.state, '', url);
      return next;
    });
  }, []);

  const changeMode = useCallback((value: SidebarMode) => {
    setMode(value);
    localStorage.setItem('webr-sidebar-mode', value);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.isComposing) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-recording="true"]')) return;
      if (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault(); setPaletteOpen((value) => !value); return;
      }
      if (paletteOpen || event.defaultPrevented) return;
      const action = appShortcutAction(event, getShortcuts());
      if (!action) return;
      event.preventDefault();
      if (action === 'toggleSidebar') toggleSidebar();
      if (action === 'toggleTerminal') toggleTerminal();
       if (action === 'newThread') void navigate(`/new${thread ? `?project=${encodeURIComponent(thread.projectId)}` : ''}`);
       if ((action === 'nextPane' || action === 'previousPane') && thread?.panes.length) {
         const index = thread.panes.findIndex((pane) => pane.id === focusedPane);
         focusPane(thread.panes[(index + (action === 'nextPane' ? 1 : -1) + thread.panes.length) % thread.panes.length].id);
       }
      if ((action === 'nextThread' || action === 'previousThread') && threads.length) {
        const index = threads.findIndex((item) => item.id === thread?.id);
        const next = action === 'nextThread' ? (index + 1) % threads.length : (index - 1 + threads.length) % threads.length;
         void navigate(`/threads/${encodeURIComponent(threads[next].id)}`);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [thread, threads, paletteOpen, toggleSidebar, toggleTerminal, focusPane, focusedPane, setFocusedPane]);

  return <div className="app-shell">
    <Sidebar projects={projects} threads={threads} archived={archived} machines={machines} currentId={thread?.id} mode={mode} onModeChange={changeMode} collapsed={collapsed}
      mobileOpen={mobileOpen} onCollapse={toggleSidebar} onCloseMobile={() => setMobileOpen(false)} />
    <div className="main-panel">
      {page === 'thread' && thread && <ThreadView thread={thread} layouts={projections[thread.machineId]?.layouts ?? []} tabs={projections[thread.machineId]?.availableTabs ?? []} connected={gatewayConnected && !!projections[thread.machineId]?.connected} canControl={!!machines.find((machine) => machine.id === thread.machineId)?.writable} focusedPane={focusedPane} onFocusPane={focusPane} onToggleTerminal={() => toggleTerminal()} />}
      {page === 'new' && <NewThreadView projects={projects} machines={machines} selectedProjectId={projectId} onOpenSidebar={toggleSidebar} />}
      {page === 'settings' && <SettingsView onOpenSidebar={toggleSidebar} />}
      {page === 'missing' && <main className="not-found"><h1>Thread not found</h1><a href="/">Open a thread</a></main>}
    </div>
    {page === 'thread' && <div className="mobile-controls"><button aria-label="Open sidebar" onClick={toggleSidebar}><PanelLeft size={16} /></button><button aria-label="Open command palette" onClick={() => setPaletteOpen(true)}><Search size={16} /></button></div>}
    {perfAvailable && <PerfOverlay />}
    <PairingPrompt />
    <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} projects={projects} threads={threads} thread={thread} focusedPane={focusedPane}
      mode={mode} onModeChange={changeMode} onToggleSidebar={toggleSidebar} onFocusPane={focusPane} onTerminalAction={(action) => { const pane = thread?.panes.find((pane) => pane.id === focusedPane); if (thread && pane?.terminalId) terminals.command(thread.machineId, thread.id, pane.terminalId, action); }}
      onToggleTerminal={toggleTerminal} onCloseTerminal={closeTerminal} />
  </div>;
}
