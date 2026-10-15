import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CommandPalette } from './CommandPalette';
import { MobileTopBar } from './MobileTopBar';
import { PrefixOverlay } from './PrefixOverlay';
import { PerfOverlay } from './PerfOverlay';
import { PairingPrompt } from './PairingPrompt';
import { CrashReport } from './CrashReport';
import { NewThreadView } from './NewThreadView';
import { SettingsView } from './SettingsView';
import { Sidebar, type SidebarMode } from './Sidebar';
import { UpdateButton } from './UpdateButton';
import { applyTheme } from './ThemeControl';
import { ThreadView } from './ThreadView';
import { TerminalTabView } from './TerminalTabView';
import { getShortcuts, keyCombo, loadShortcuts, type ShortcutAction } from './shortcuts';
import { navigate } from 'astro:transitions/client';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from 'zustand';
import { RuntimeProvider, useRuntime, useRuntimeSelector } from '../client/provider';
import type { Bootstrap } from '../shared/runtime';
import type { Pane } from '../lib/models';
import { selectTerminalMachine } from '../lib/machines';
import { uuid } from '../lib/uuid';
import { appShortcutAction, armLeaderPrefix, paletteToggle, sequenceAction, sequenceStarters, subscribeLeaderPrefix, takeLeaderPrefix, requestThreadRename } from '../client/keyboard';
import { perfAvailable, startPerf } from '../client/perf';
import { closeThreadPane, openThreadTerminal } from '../client/thread-actions';
import { openTerminalTab } from '../client/terminal-navigation';
import { canClosePane, paneToFocusAfterClosing } from '../lib/pane-strip';
import { usePaneWindowStart, useNarrowScreen } from '../client/pane-window';
import { alertDialog, confirmDialog } from './dialogs';
import { useClearDoneOnVisit } from '../client/clear-done-on-visit';
import { decideFlipNavigation, floatingTabsFromProjections, partitionSidebar, sidebarTabKey } from '../lib/floating';
import { carriesFiles } from '../client/image-attach';
import { trackVisualViewport } from '../client/visual-viewport';
import { terminalStartupStorageKey, type TerminalStartupPreset } from '../client/terminal-presets';
import { clearLaunchDraft, clearNewThreadDraftForLaunch } from '../client/new-thread-draft';

type Props = {
  page: 'thread' | 'terminal' | 'new' | 'settings' | 'missing';
  bootstrap: Bootstrap;
  threadId?: string;
  machineId?: string;
  tabId?: string;
  projectId?: string;
  terminalPending?: boolean;
  terminalStartup?: TerminalStartupPreset;
};

const keepTerminalFocus = (event: React.PointerEvent) => event.preventDefault();

export default function App(props: Props) {
  return <CrashReport><RuntimeProvider bootstrap={props.bootstrap}><RuntimeApp {...props} /></RuntimeProvider></CrashReport>;
}

function RuntimeApp({ page, bootstrap, threadId, machineId, tabId, projectId, terminalPending = false, terminalStartup }: Props) {
  const { ui, terminals } = useRuntime();
  const projects = useRuntimeSelector(useShallow((state) => state.projectIds.map((id) => state.projects[id])));
  const activeThreads = useRuntimeSelector(useShallow((state) => state.threadIds.map((id) => state.threads[id]).filter((item) => !item.archivedAt)));
  const archived = useRuntimeSelector(useShallow((state) => state.threadIds.map((id) => state.threads[id]).filter((item) => !!item.archivedAt)));
  const thread = useRuntimeSelector((state) => state.threads[threadId ?? '']);
  const projections = useRuntimeSelector((state) => state.projections);
  const gatewayConnected = useRuntimeSelector((state) => state.connected);
  const standaloneTab = useRuntimeSelector((state) => page === 'terminal' ? state.projections[machineId ?? '']?.availableTabs?.find((tab) => tab.tabId === tabId && !tab.bound) : undefined);
  const unboundTabs = useRuntimeSelector(useShallow((state) => floatingTabsFromProjections(state.projections, Object.fromEntries(bootstrap.machines.map((machine) => [machine.id, machine.session])))));
  const { listed: threads, detached, terminals: floating, ownedTabs } = useMemo(() => partitionSidebar(activeThreads, unboundTabs), [activeThreads, unboundTabs]);
  const terminalPanes: Pane[] = standaloneTab?.panes.map((pane) => ({ ...pane, kind: 'shell' })) ?? [];
  const machines = Object.values(projections).flatMap((projection) => { const machine = projection.machine ?? bootstrap.machines.find((machine) => machine.id === projection.machineId); return machine ? [{ ...machine, connected: gatewayConnected && projection.connected, error: projection.error }] : []; });
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcuts, setShortcuts] = useState(getShortcuts);
  const [armedPrefix, setArmedPrefix] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void loadShortcuts().then((next) => { if (live) setShortcuts(next); });
    return () => { live = false; };
  }, []);
  useEffect(() => subscribeLeaderPrefix(setArmedPrefix), []);
  const [pendingTerminalStartup, setPendingTerminalStartup] = useState<TerminalStartupPreset>();
  const [terminalLookupTimedOut, setTerminalLookupTimedOut] = useState(false);
  useEffect(() => {
    if (page !== 'terminal' || !terminalStartup || !machineId || !tabId) { setPendingTerminalStartup(undefined); return; }
    const key = terminalStartupStorageKey(machineId, tabId);
    try {
      const stored = sessionStorage.getItem(key);
      if (stored && stored !== terminalStartup) { setPendingTerminalStartup(undefined); return; }
    } catch { /* Continue from the whitelisted URL preset when storage is unavailable. */ }
    setPendingTerminalStartup(terminalStartup);
  }, [page, terminalStartup, machineId, tabId]);
  useEffect(() => {
    if (page !== 'terminal' || !terminalPending || standaloneTab) { setTerminalLookupTimedOut(false); return; }
    const timeout = window.setTimeout(() => setTerminalLookupTimedOut(true), 10_000);
    return () => window.clearTimeout(timeout);
  }, [page, terminalPending, standaloneTab, machineId, tabId]);
  useEffect(() => {
    if (page === 'terminal' && standaloneTab) document.title = `${standaloneTab.label} · Webr`;
  }, [page, standaloneTab]);
  const completeTerminalStartup = useCallback(() => {
    if (machineId && tabId) {
      try { sessionStorage.removeItem(terminalStartupStorageKey(machineId, tabId)); } catch { /* The startup command has already been sent. */ }
    }
    setPendingTerminalStartup(undefined);
    const url = new URL(window.location.href);
    url.searchParams.delete('startup');
    window.history.replaceState(window.history.state, '', url);
  }, [machineId, tabId]);
  useEffect(startPerf, []);
  useEffect(trackVisualViewport, []);
  const [mode, setMode] = useState<SidebarMode>('threads');
  const scope = page === 'terminal' ? `${machineId ?? ''}:tab:${tabId ?? ''}` : `${thread?.machineId ?? ''}:${thread?.id ?? ''}`;
  const storedFocus = useStore(ui, (state) => state.focusedPanes[scope]);
  const activePanes = page === 'terminal' ? terminalPanes : thread?.panes ?? [];
  const focusedPane = activePanes.some((pane) => pane.id === storedFocus) ? storedFocus! : activePanes[0]?.id ?? '';
  const setFocusedPane = useCallback((paneId: string) => ui.getState().focus(scope, paneId), [ui, scope]);
  useClearDoneOnVisit(page === 'thread' ? thread : undefined, focusedPane, gatewayConnected && !!machines.find((machine) => machine.id === thread?.machineId)?.writable);
  useEffect(() => {
    if (page !== 'thread' || thread?.operation?.state !== 'ready') return;
    clearLaunchDraft(thread.id);
    clearNewThreadDraftForLaunch(thread.id);
  }, [page, thread?.id, thread?.operation?.state]);

  const shownThreadId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (thread) shownThreadId.current = thread.id;
    else if (page === 'thread' && shownThreadId.current === threadId) void navigate('/');
  }, [thread, page, threadId]);

  const sidebarOrder = useMemo(() => [
    ...threads.map((item) => ({ threadId: item.id, tab: ownedTabs.get(item.id) })),
    ...floating.map((tab) => ({ threadId: undefined, tab })),
  ], [threads, floating, ownedTabs]);
  const viewedTerminalSlot = useRef<{ key: string; index: number } | undefined>(undefined);
  useEffect(() => {
    if (page !== 'terminal' || !machineId || !tabId) { viewedTerminalSlot.current = undefined; return; }
    const key = sidebarTabKey(machineId, tabId);
    if (standaloneTab?.panes.length) {
      viewedTerminalSlot.current = { key, index: sidebarOrder.findIndex((row) => row.tab && sidebarTabKey(row.tab.machineId, row.tab.tabId) === key) };
      return;
    }
    if (viewedTerminalSlot.current?.key !== key) return;
    const next = sidebarOrder[Math.min(viewedTerminalSlot.current.index, sidebarOrder.length - 1)];
    viewedTerminalSlot.current = undefined;
    if (!next) { void navigate('/'); return; }
    if (next.threadId) { void navigate(`/threads/${encodeURIComponent(next.threadId)}`); return; }
    const machine = machines.find((item) => item.id === next.tab!.machineId);
    const session = next.tab!.session || machine?.session || 'default';
    void navigate(`/sessions/${encodeURIComponent(session)}/tabs/${encodeURIComponent(next.tab!.tabId)}?machine=${encodeURIComponent(next.tab!.machineId)}`);
  }, [page, machineId, tabId, standaloneTab, sidebarOrder, machines]);

  const flipNavigated = useRef<string>('');
  const allThreads = useRuntimeSelector(useShallow((state) => state.threadIds.map((id) => state.threads[id])));
  useEffect(() => {
    const launchingOrRestoring = allThreads.some((item) => ['pending', 'running'].includes(item.operation?.state ?? '')) || thread?.operation?.state === 'running';
    const nav = decideFlipNavigation({ page, viewedThreadId: threadId, viewedMachineId: machineId ?? thread?.machineId, viewedTabId: tabId ?? thread?.tabId, threads: allThreads, floating: unboundTabs, launchingOrRestoring });
    if (nav.to === 'thread') {
      const key = `thread:${nav.threadId}`;
      if (flipNavigated.current !== key) { flipNavigated.current = key; void navigate(`/threads/${encodeURIComponent(nav.threadId)}`); }
    } else if (nav.to === 'terminal') {
      const machine = machines.find((item) => item.id === nav.machineId);
      const session = nav.session || machine?.session || bootstrap.machines.find((item) => item.id === nav.machineId)?.session || 'default';
      const key = `terminal:${nav.machineId}:${nav.tabId}`;
      if (flipNavigated.current !== key) { flipNavigated.current = key; void navigate(`/sessions/${encodeURIComponent(session)}/tabs/${encodeURIComponent(nav.tabId)}?machine=${encodeURIComponent(nav.machineId)}`); }
    }
  }, [page, threadId, tabId, machineId, thread, allThreads, unboundTabs, machines, bootstrap.machines]);

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

  const terminalMachine = selectTerminalMachine(machines, page === 'terminal' ? machineId : thread?.machineId);
  const reportPaneFailure = (error: unknown) => void alertDialog(error instanceof Error ? error.message : 'Herdr could not change the pane.');
  const paneIds = activePanes.map((pane) => pane.id);
  const windowStart = usePaneWindowStart(ui, scope, paneIds, focusedPane);
  const narrow = useNarrowScreen();
  const openTerminal = useCallback(() => {
    if (!thread || !focusedPane) return;
    void openThreadTerminal(thread, focusedPane).then(({ paneId }) => setFocusedPane(paneId), reportPaneFailure);
  }, [thread, focusedPane, setFocusedPane]);
  const standaloneTerminalBusy = useRef(false);
  const standaloneTerminalOperation = useRef<{ payload: string; key: string } | null>(null);
  const openStandaloneTerminal = useCallback(async (startup?: TerminalStartupPreset) => {
    const machine = terminalMachine;
    if (!machine || !machine.connected || !machine.writable || standaloneTerminalBusy.current) return;
    const path = '~/';
    const payload = JSON.stringify({ machineId: machine.id, path, startup });
    const key = standaloneTerminalOperation.current?.payload === payload ? standaloneTerminalOperation.current.key : uuid();
    standaloneTerminalOperation.current = { payload, key };
    standaloneTerminalBusy.current = true;
    try {
      await openTerminalTab(machine, path, key, startup);
      standaloneTerminalOperation.current = null;
    } catch (error) { void alertDialog(error instanceof Error ? error.message : 'Herdr could not create a terminal.'); }
    finally { standaloneTerminalBusy.current = false; }
  }, [terminalMachine]);
  const closePane = useCallback(async (paneId = focusedPane) => {
    if (!thread || !canClosePane(thread, paneId)) return;
    const pane = thread.panes.find((pane) => pane.id === paneId)!;
    const next = paneToFocusAfterClosing(thread.panes, windowStart, paneId);
    try {
      let result = await closeThreadPane(thread, paneId, false);
      if (result.busy && await confirmDialog(`${pane.title} is running a process. Close it anyway?`, { confirmLabel: 'Close', danger: true })) result = await closeThreadPane(thread, paneId, true);
      if (result.closed && next) setFocusedPane(next.id);
    } catch (error) { reportPaneFailure(error); }
  }, [thread, focusedPane, windowStart, setFocusedPane]);

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
    const runAction = (action: ShortcutAction) => {
      if (action === 'toggleSidebar') toggleSidebar();
      if (action === 'openTerminal') openTerminal();
      if (action === 'closePane') void closePane();
      if (action === 'renameThread' && page === 'thread' && thread) {
        // The editor lives in the sidebar row, so make sure it is visible first.
        if (window.matchMedia('(max-width: 760px)').matches) setMobileOpen(true);
        else if (collapsed) toggleSidebar();
        const id = thread.id;
        requestAnimationFrame(() => requestThreadRename(id));
      }
      if (action === 'newThread') void navigate(`/new${thread ? `?project=${encodeURIComponent(thread.projectId)}` : ''}`);
      if ((action === 'nextPane' || action === 'previousPane') && thread?.panes.length) {
        const index = thread.panes.findIndex((pane) => pane.id === focusedPane);
        setFocusedPane(thread.panes[(index + (action === 'nextPane' ? 1 : -1) + thread.panes.length) % thread.panes.length].id);
      }
      if ((action === 'nextThread' || action === 'previousThread') && (threads.length || floating.length)) {
        const items: ({ kind: 'thread'; id: string } | { kind: 'terminal'; machineId: string; tabId: string; session: string })[] = [
          ...threads.map((item) => ({ kind: 'thread' as const, id: item.id })),
          ...floating.map((item) => ({ kind: 'terminal' as const, machineId: item.machineId, tabId: item.tabId, session: item.session })),
        ];
        const currentIndex = page === 'terminal'
          ? items.findIndex((item) => item.kind === 'terminal' && item.machineId === machineId && item.tabId === tabId)
          : items.findIndex((item) => item.kind === 'thread' && item.id === thread?.id);
        const next = items[(currentIndex + (action === 'nextThread' ? 1 : -1) + items.length) % items.length];
        if (next?.kind === 'thread') void navigate(`/threads/${encodeURIComponent(next.id)}`);
        else if (next) {
          const machine = machines.find((item) => item.id === next.machineId);
          const session = next.session || machine?.session || bootstrap.machines.find((item) => item.id === next.machineId)?.session || 'default';
          void navigate(`/sessions/${encodeURIComponent(session)}/tabs/${encodeURIComponent(next.tabId)}?machine=${encodeURIComponent(next.machineId)}`);
        }
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.isComposing) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-recording="true"]')) return;
      const combo = keyCombo(event);
      // Pure modifier presses never disturb an armed prefix.
      if (!combo) return;
      // Consume any armed prefix first so it cannot go stale behind the palette.
      const first = takeLeaderPrefix();
      // Read storage live so changes made in Settings (including the prefix)
      // apply without remounting; state covers the async Herdr keymap load.
      const stored = { ...shortcuts, ...getShortcuts() };
      if (paletteToggle(first, combo, stored)) {
        event.preventDefault(); setPaletteOpen((value) => !value); return;
      }
      if (paletteOpen || event.defaultPrevented) return;
      if (first) {
        // Pressing the prefix twice sends one literal prefix to the terminal.
        if (combo === first) return;
        const sequenced = sequenceAction(first, combo, stored);
        if (sequenced) { event.preventDefault(); runAction(sequenced); return; }
        if (sequenceStarters(stored).has(combo)) { event.preventDefault(); armLeaderPrefix(combo); return; }
        const single = appShortcutAction(event, stored);
        if (!single) return;
        event.preventDefault();
        runAction(single);
        return;
      }
      if (sequenceStarters(stored).has(combo)) { event.preventDefault(); armLeaderPrefix(combo); return; }
      const action = appShortcutAction(event, stored);
      if (!action) return;
      event.preventDefault();
      runAction(action);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [thread, threads, floating, page, machineId, tabId, machines, bootstrap.machines, paletteOpen, toggleSidebar, openTerminal, closePane, focusedPane, setFocusedPane, shortcuts, collapsed]);

  return <div className={`app-shell ${page === 'thread' || page === 'terminal' ? 'is-thread' : ''}`}>
    <Sidebar projects={projects} threads={threads} archived={archived} floating={floating} detached={detached} ownedTabs={ownedTabs} machines={machines} currentId={thread?.id} currentMachineId={page === 'terminal' ? machineId : thread?.machineId} currentTab={page === 'terminal' && machineId && tabId ? { machineId, tabId } : undefined} mode={mode} onModeChange={changeMode} collapsed={collapsed}
      mobileOpen={mobileOpen} onCollapse={toggleSidebar} onCloseMobile={() => setMobileOpen(false)} onOpenPalette={() => setPaletteOpen(true)} paletteShortcut={shortcuts.commandPalette} updateAction={<UpdateButton />} />
    <div className="main-panel">
      {narrow && (page === 'thread' || page === 'terminal') && <MobileTopBar panes={page === 'thread' ? thread?.panes ?? [] : terminalPanes} focusedPane={focusedPane} onFocusPane={setFocusedPane} onOpenSidebar={toggleSidebar} onOpenPalette={() => setPaletteOpen(true)} keepTerminalFocus={keepTerminalFocus} />}
      {page === 'thread' && thread && <ThreadView thread={thread} connected={gatewayConnected && !!projections[thread.machineId]?.connected} canControl={!!machines.find((machine) => machine.id === thread.machineId)?.writable} focusedPane={focusedPane} onFocusPane={setFocusedPane} windowStart={windowStart} narrow={narrow} />}
      {page === 'terminal' && machineId && tabId && <TerminalTabView machineId={machineId} tabId={tabId} panes={terminalPanes} connected={gatewayConnected && !!projections[machineId]?.connected} canControl={!!machines.find((machine) => machine.id === machineId)?.writable} focusedPane={focusedPane} onFocusPane={setFocusedPane} windowStart={windowStart} narrow={narrow} pending={terminalPending && !standaloneTab && !terminalLookupTimedOut} startupPreset={pendingTerminalStartup} onStartupComplete={completeTerminalStartup} />}
      {page === 'new' && <NewThreadView key={projectId} projects={projects} machines={machines} selectedProjectId={projectId} onOpenSidebar={toggleSidebar} />}
      {page === 'settings' && <SettingsView onOpenSidebar={toggleSidebar} />}
      {page === 'missing' && <main className="not-found"><h1>Thread not found</h1><a href="/">Open a thread</a></main>}
    </div>
    {perfAvailable && <PerfOverlay />}
    <PairingPrompt />
    <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} projects={projects} threads={threads} floating={floating} machines={machines} thread={thread} focusedPane={focusedPane} onNewTerminal={terminalMachine ? openStandaloneTerminal : undefined} onOpenResourceMonitor={terminalMachine ? () => openStandaloneTerminal('resource-monitor') : undefined}
      mode={mode} onModeChange={changeMode} onToggleSidebar={toggleSidebar} onFocusPane={setFocusedPane} onTerminalAction={(action) => { const pane = thread?.panes.find((pane) => pane.id === focusedPane); if (thread && pane?.terminalId) terminals.command(thread.machineId, thread.id, pane.terminalId, action); }}
      onOpenTerminal={openTerminal} onClosePane={() => void closePane()} />
    {armedPrefix && !paletteOpen && <PrefixOverlay prefix={armedPrefix} shortcuts={{ ...shortcuts, ...getShortcuts() }} />}
  </div>;
}
