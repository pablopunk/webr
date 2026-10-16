import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CommandPalette } from './CommandPalette';
import { MobileTopBar } from './MobileTopBar';
import { PrefixOverlay } from './PrefixOverlay';
import { PerfOverlay } from './PerfOverlay';
import { PairingPrompt } from './PairingPrompt';
import { CrashReport } from './CrashReport';
import { NewThreadView } from './NewThreadView';
import { PendingOperation, PendingResourceOperation } from './PendingOperation';
import { SettingsView } from './SettingsView';
import { Sidebar, type SidebarMode } from './Sidebar';
import { UpdateButton } from './UpdateButton';
import { applyTheme } from './ThemeControl';
import { ThreadView } from './ThreadView';
import { TerminalTabView } from './TerminalTabView';
import { getShortcuts, keyCombo, loadShortcuts, type ShortcutAction } from './shortcuts';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from 'zustand';
import { RuntimeProvider, useRuntime, useRuntimeSelector } from '../client/provider';
import { threadDisplayTitle, threadIsArchived } from '../client/pending-metadata';
import { LoadingOrb } from './LoadingOrb';
import { handleRouteClick, RouteNavigationProvider, useRouteNavigation } from '../client/app-navigation';
import { isListedThread } from '../lib/launch';
import type { Bootstrap } from '../shared/runtime';
import type { Pane } from '../lib/models';
import { selectTerminalMachine } from '../lib/machines';
import { windowStartShowing } from '../lib/pane-strip';
import { appShortcutAction, armLeaderPrefix, paletteToggle, sequenceAction, sequenceStarters, subscribeLeaderPrefix, takeLeaderPrefix, requestThreadRename } from '../client/keyboard';
import { perfAvailable, startPerf } from '../client/perf';
import { usePendingPaneActions } from '../client/pending-pane-actions';
import { openTerminalTab } from '../client/terminal-navigation';
import { usePaneWindowStart, useNarrowScreen } from '../client/pane-window';
import { alertDialog, confirmDialog } from './dialogs';
import { useClearDoneOnVisit } from '../client/clear-done-on-visit';
import { decideFlipNavigation, floatingTabsFromProjections, partitionSidebar, sidebarTabKey } from '../lib/floating';
import { carriesFiles } from '../client/image-attach';
import { trackVisualViewport } from '../client/visual-viewport';
import { terminalStartupStorageKey, type TerminalStartupPreset } from '../client/terminal-presets';
import { clearLaunchDraft, clearNewThreadDraftForLaunch } from '../client/new-thread-draft';
import { sidebarNavigationHref } from '../client/sidebar-navigation';

type Props = { initialUrl: string; bootstrap: Bootstrap };

const keepTerminalFocus = (event: React.PointerEvent) => event.preventDefault();

export default function App(props: Props) {
  return <CrashReport><RuntimeProvider bootstrap={props.bootstrap}><RouteNavigationProvider initialUrl={props.initialUrl}><RuntimeApp bootstrap={props.bootstrap} /></RouteNavigationProvider></RuntimeProvider></CrashReport>;
}

function RuntimeApp({ bootstrap }: Pick<Props, 'bootstrap'>) {
  const { route, navigate } = useRouteNavigation();
  const { ui, terminals, tickets, metadata } = useRuntime();
  const projects = useRuntimeSelector(useShallow((state) => state.projectIds.map((id) => state.projects[id])));
  const metadataFields = useRuntimeSelector((state) => state.metadataFields);
  const activeThreads = useRuntimeSelector(useShallow((state) => state.threadIds.map((id) => state.threads[id]).filter((item) => !threadIsArchived(item, state.metadataFields))));
  const archived = useRuntimeSelector(useShallow((state) => state.threadIds.map((id) => state.threads[id]).filter((item) => threadIsArchived(item, state.metadataFields))));
  const projections = useRuntimeSelector((state) => state.projections);
  const gatewayConnected = useRuntimeSelector((state) => state.connected);
  const routeMachineSession = route.type === 'terminal'
    ? projections[route.machineId]?.machine?.session ?? bootstrap.machines.find((machine) => machine.id === route.machineId)?.session
    : undefined;
  const thread = useRuntimeSelector((state) => {
    if (route.type === 'thread') return state.threadIds.map((key) => state.threads[key]).find((item) => item.id === route.threadId);
    if (route.type !== 'terminal' || routeMachineSession !== route.session) return undefined;
    return state.threadIds.map((id) => state.threads[id]).find((item) => item.machineId === route.machineId
      && item.session === route.session && item.tabId === route.tabId && item.bindingState === 'attached' && isListedThread(item));
  });
  const page = route.type === 'composer' ? 'new'
    : route.type === 'settings' ? 'settings'
      : route.type === 'thread' || route.type === 'terminal' && thread ? 'thread'
        : route.type === 'terminal' ? 'terminal' : 'missing';
  const threadId = route.type === 'thread' ? route.threadId : thread?.id;
  const machineId = route.type === 'terminal' ? route.machineId : thread?.machineId;
  const tabId = route.type === 'terminal' ? route.tabId : thread?.tabId;
  const projectId = route.type === 'composer' ? route.projectId : undefined;
  const terminalStartup = route.type === 'terminal' ? route.startupPreset : undefined;
  const standaloneTab = useRuntimeSelector((state) => route.type === 'terminal' && routeMachineSession === route.session ? state.projections[route.machineId]?.availableTabs?.find((tab) => tab.tabId === route.tabId && !tab.bound) : undefined);
  const unboundTabs = useRuntimeSelector(useShallow((state) => floatingTabsFromProjections(state.projections, Object.fromEntries(bootstrap.machines.map((machine) => [machine.id, machine.session])))));
  const { listed: threads, detached, terminals: floating, ownedTabs } = useMemo(() => partitionSidebar(activeThreads, unboundTabs), [activeThreads, unboundTabs]);
  const terminalPanes: Pane[] = standaloneTab?.panes.map((pane) => ({ ...pane, kind: 'shell' })) ?? [];
  const machines = Object.values(projections).flatMap((projection) => { const machine = projection.machine ?? bootstrap.machines.find((machine) => machine.id === projection.machineId); return machine ? [{ ...machine, connected: gatewayConnected && projection.connected && !!projection.freshAt, error: projection.error }] : []; });
  const routeProjection = route.type === 'terminal' ? projections[route.machineId] : undefined;
  const terminalMissing = route.type === 'terminal' && routeMachineSession === route.session
    && routeProjection?.connected === true && !!routeProjection.freshAt && !thread && !standaloneTab;
  const terminalPending = route.type === 'terminal' && !thread && !standaloneTab && !terminalMissing;
  const collapsed = route.type !== 'unsupported' && route.sidebarCollapsed;
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
    const title = page === 'settings' ? 'Settings'
      : page === 'new' ? route.type === 'composer' && route.resourcePendingKey ? 'Creating resource…' : route.type === 'composer' && route.pendingKey ? 'Starting thread…' : 'New thread'
        : page === 'thread' ? thread ? threadDisplayTitle(thread) : 'Opening thread…'
          : page === 'terminal' ? standaloneTab?.label ?? (terminalPending ? 'Opening terminal…' : terminalMissing ? 'Terminal tab not found' : 'Terminal')
            : 'Webr';
    document.title = page === 'missing' ? 'Webr' : `${title} · Webr`;
  }, [page, route, thread?.title, thread?.titleOverride, standaloneTab?.label, terminalPending, terminalMissing]);
  const completeTerminalStartup = useCallback(() => {
    if (machineId && tabId) {
      try { sessionStorage.removeItem(terminalStartupStorageKey(machineId, tabId)); } catch { /* The startup command has already been sent. */ }
    }
    setPendingTerminalStartup(undefined);
    const url = new URL(window.location.href);
    url.searchParams.delete('startup');
    navigate(url.href, { replace: true });
  }, [machineId, tabId, navigate]);
  useEffect(startPerf, []);
  useEffect(trackVisualViewport, []);
  const [mode, setMode] = useState<SidebarMode>('threads');
  const scope = page === 'terminal' ? `${machineId ?? ''}:tab:${tabId ?? ''}` : `${thread?.machineId ?? ''}:${thread?.id ?? ''}`;
  const storedFocus = useStore(ui, (state) => state.focusedPanes[scope]);
  const storedPaneWindow = useStore(ui, (state) => state.paneWindows[scope] ?? 0);
  const activePanes = page === 'terminal' ? terminalPanes : thread?.panes ?? [];
  const focusedPane = activePanes.some((pane) => pane.id === storedFocus) ? storedFocus! : activePanes[0]?.id ?? '';
  const mainPanel = useRef<HTMLDivElement>(null);
  const [paneFocusRequest, requestPaneFocus] = useState<{ scope: string; paneId: string }>();
  const consumedPaneFocus = useRef<typeof paneFocusRequest>(undefined);
  const setFocusedPane = useCallback((paneId: string) => {
    ui.getState().focus(scope, paneId);
    requestPaneFocus({ scope, paneId });
  }, [ui, scope]);
  useLayoutEffect(() => {
    if (!paneFocusRequest || consumedPaneFocus.current === paneFocusRequest) return;
    // Only explicit pointer/keyboard/palette navigation may leave an editor.
    // Consume once: a later remount or baseline must not replay this intent.
    consumedPaneFocus.current = paneFocusRequest;
    if (paneFocusRequest.scope !== scope || paneFocusRequest.paneId !== focusedPane || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
    mainPanel.current?.querySelector<HTMLTextAreaElement>('.terminal-pane.is-active .terminal-input-capture')?.focus({ preventScroll: true });
  }, [paneFocusRequest, scope, focusedPane]);
  useClearDoneOnVisit(page === 'thread' ? thread : undefined, focusedPane, !!machines.find((machine) => machine.id === thread?.machineId)?.connected && !!machines.find((machine) => machine.id === thread?.machineId)?.writable);
  useEffect(() => {
    if (page !== 'thread' || thread?.operation?.state !== 'ready') return;
    clearLaunchDraft(tickets.recoveryScope, thread.id);
    clearNewThreadDraftForLaunch(tickets.recoveryScope, thread.id);
  }, [page, thread?.id, thread?.operation?.state, tickets.recoveryScope]);

  const knownThreadMachines = useRef(new Map<string, string>());
  useEffect(() => {
    if (route.type === 'thread' && thread) knownThreadMachines.current.set(route.threadId, thread.machineId);
  }, [route, thread]);
  const threadIsAuthoritativelyMissing = route.type === 'thread' && !thread && (() => {
    const knownMachineId = knownThreadMachines.current.get(route.threadId);
    const isFresh = (machineId: string) => projections[machineId]?.connected === true && !!projections[machineId]?.freshAt;
    if (knownMachineId) return isFresh(knownMachineId);
    return bootstrap.machines.length > 0 && bootstrap.machines.every((machine) => isFresh(machine.id));
  })();

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
    if (!terminalMissing || viewedTerminalSlot.current?.key !== key) return;
    const next = sidebarOrder[Math.min(viewedTerminalSlot.current.index, sidebarOrder.length - 1)];
    viewedTerminalSlot.current = undefined;
    if (!next) { void navigate('/'); return; }
    if (next.threadId) { void navigate(`/threads/${encodeURIComponent(next.threadId)}`); return; }
    const machine = machines.find((item) => item.id === next.tab!.machineId);
    const session = next.tab!.session || machine?.session || 'default';
    void navigate(`/sessions/${encodeURIComponent(session)}/tabs/${encodeURIComponent(next.tab!.tabId)}?machine=${encodeURIComponent(next.tab!.machineId)}`);
  }, [page, machineId, tabId, standaloneTab, terminalMissing, sidebarOrder, machines]);

  const flipNavigated = useRef<string>('');
  const allThreads = useRuntimeSelector(useShallow((state) => state.threadIds.map((id) => state.threads[id])));
  useEffect(() => {
    const viewedMachineId = thread?.machineId ?? (route.type === 'terminal' ? route.machineId : undefined);
    const observation = viewedMachineId ? projections[viewedMachineId] : undefined;
    if (!observation?.connected || !observation.freshAt) { flipNavigated.current = ''; return; }
    const launchingOrRestoring = allThreads.some((item) => ['pending', 'running'].includes(item.operation?.state ?? '')) || thread?.operation?.state === 'running';
    const nav = decideFlipNavigation({ page, viewedThreadId: threadId, viewedMachineId: machineId ?? thread?.machineId, viewedTabId: tabId ?? thread?.tabId, threads: allThreads, floating: unboundTabs, launchingOrRestoring });
    if (nav.to === 'thread') {
      const key = `thread:${nav.threadId}`;
      if (flipNavigated.current !== key) { flipNavigated.current = key; navigate(`/threads/${encodeURIComponent(nav.threadId)}`); }
      return;
    }
    if (nav.to === 'terminal') {
      const machine = machines.find((item) => item.id === nav.machineId);
      const session = nav.session || machine?.session || bootstrap.machines.find((item) => item.id === nav.machineId)?.session || 'default';
      const key = `terminal:${nav.machineId}:${nav.tabId}`;
      if (flipNavigated.current !== key) { flipNavigated.current = key; navigate(`/sessions/${encodeURIComponent(session)}/tabs/${encodeURIComponent(nav.tabId)}?machine=${encodeURIComponent(nav.machineId)}`); }
      return;
    }
    flipNavigated.current = '';
  }, [page, route, threadId, tabId, machineId, thread, allThreads, unboundTabs, machines, projections, bootstrap.machines, navigate]);

  useEffect(() => {
    const keepFileDropsInsideTheApp = (event: DragEvent) => { if (carriesFiles(event.dataTransfer)) event.preventDefault(); };
    window.addEventListener('dragover', keepFileDropsInsideTheApp); window.addEventListener('drop', keepFileDropsInsideTheApp);
    return () => { window.removeEventListener('dragover', keepFileDropsInsideTheApp); window.removeEventListener('drop', keepFileDropsInsideTheApp); };
  }, []);

  useEffect(() => {
    setMode(localStorage.getItem('webr-sidebar-mode') === 'projects' ? 'projects' : 'threads');
    const media = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => { if ((localStorage.getItem('webr-theme') ?? 'system') === 'system') applyTheme('system'); };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const terminalMachine = selectTerminalMachine(machines, page === 'terminal' ? machineId : thread?.machineId);
  const actionWindowStart = windowStartShowing(activePanes.length, storedPaneWindow, activePanes.findIndex((pane) => pane.id === focusedPane));
  const narrow = useNarrowScreen();
  const paneActionRouteKey = page === 'thread' && thread
    ? JSON.stringify([thread.machineId, thread.id, thread.tabId, thread.session, thread.bindingFingerprint, thread.bindingConfigVersion])
    : '';
  const focusPaneAtScope = useCallback((targetScope: string, paneId: string) => ui.getState().focus(targetScope, paneId), [ui]);
  const confirmPaneClose = useCallback((message: string) => confirmDialog(message, { confirmLabel: 'Close', danger: true }), []);
  const paneActions = usePendingPaneActions({ thread: page === 'thread' ? thread : undefined, projection: thread ? projections[thread.machineId] : undefined,
    routeKey: paneActionRouteKey, scope, focusedPane, windowStart: actionWindowStart, focusPane: focusPaneAtScope, confirmClose: confirmPaneClose });
  const openTerminal = paneActions.openTerminal;
  const closePane = paneActions.closePane;
  const visibleThreadPanes = thread?.panes.filter((pane) => !paneActions.pendingCloses.some((pending) => (pending.paneId === pane.id || pending.terminalId === pane.terminalId) && pending.phase === 'confirmed')) ?? [];
  const displayPanes = page === 'terminal' ? terminalPanes : visibleThreadPanes;
  const windowStart = usePaneWindowStart(ui, scope, displayPanes.map((pane) => pane.id), focusedPane);
  const standaloneTerminalBusy = useRef(false);
  const openStandaloneTerminal = useCallback(async (startup?: TerminalStartupPreset) => {
    const machine = terminalMachine;
    if (!machine || !machine.connected || !machine.writable || standaloneTerminalBusy.current) return;
    standaloneTerminalBusy.current = true;
    try { await openTerminalTab(machine, '~/', startup, tickets, navigate); }
    catch (error) { void alertDialog(error instanceof Error ? error.message : 'Herdr could not create a terminal.'); }
    finally { standaloneTerminalBusy.current = false; }
  }, [terminalMachine, tickets, navigate]);

  const toggleSidebar = useCallback(() => {
    if (window.matchMedia('(max-width: 760px)').matches) { setMobileOpen((value) => !value); return; }
    if (route.type !== 'unsupported') navigate({ ...route, sidebarCollapsed: !route.sidebarCollapsed }, { replace: true });
  }, [navigate, route]);

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
      if ((action === 'nextPane' || action === 'previousPane') && displayPanes.length) {
        const selected = ui.getState().focusedPanes[scope] ?? focusedPane;
        const index = Math.max(0, displayPanes.findIndex((pane) => pane.id === selected));
        setFocusedPane(displayPanes[(index + (action === 'nextPane' ? 1 : -1) + displayPanes.length) % displayPanes.length].id);
      }
      if ((action === 'nextThread' || action === 'previousThread') && (threads.length || floating.length)) {
        const direction = action === 'nextThread' ? 1 : -1;
        const sidebarHref = sidebarNavigationHref(direction);
        if (sidebarHref) { navigate(sidebarHref); return; }
        const items: ({ kind: 'thread'; id: string } | { kind: 'terminal'; machineId: string; tabId: string; session: string })[] = [
          ...threads.map((item) => ({ kind: 'thread' as const, id: item.id })),
          ...floating.map((item) => ({ kind: 'terminal' as const, machineId: item.machineId, tabId: item.tabId, session: item.session })),
        ];
        const currentIndex = page === 'terminal'
          ? items.findIndex((item) => item.kind === 'terminal' && item.machineId === machineId && item.tabId === tabId)
          : items.findIndex((item) => item.kind === 'thread' && item.id === thread?.id);
        const startIndex = currentIndex >= 0 ? currentIndex : direction === 1 ? -1 : 0;
        const next = items[(startIndex + direction + items.length) % items.length];
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
  }, [thread, threads, floating, page, machineId, tabId, machines, bootstrap.machines, paletteOpen, toggleSidebar, openTerminal, closePane, focusedPane, setFocusedPane, shortcuts, collapsed, navigate, displayPanes, ui, scope]);

  const handleAppLinkClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => handleRouteClick(event, navigate), [navigate]);

  return <div className={`app-shell ${page === 'thread' || page === 'terminal' ? 'is-thread' : ''}`} onClickCapture={handleAppLinkClick}>
    <Sidebar projects={projects} threads={threads} archived={archived} floating={floating} detached={detached} ownedTabs={ownedTabs} machines={machines} currentId={thread?.id} currentMachineId={page === 'terminal' ? machineId : thread?.machineId} currentTab={route.type === 'terminal' && machineId && tabId ? { machineId, tabId } : undefined} mode={mode} onModeChange={changeMode} collapsed={collapsed}
      mobileOpen={mobileOpen} onCollapse={toggleSidebar} onCloseMobile={() => setMobileOpen(false)} onOpenPalette={() => setPaletteOpen(true)} onNavigate={navigate} paletteShortcut={shortcuts.commandPalette} updateAction={<UpdateButton />} metadata={metadata} metadataFields={metadataFields} />
    <div ref={mainPanel} className="main-panel">
      {narrow && (page === 'thread' || page === 'terminal') && <MobileTopBar panes={page === 'thread' ? visibleThreadPanes : terminalPanes} focusedPane={focusedPane} onFocusPane={setFocusedPane} onOpenSidebar={toggleSidebar} onOpenPalette={() => setPaletteOpen(true)} keepTerminalFocus={keepTerminalFocus} />}
      {page === 'thread' && thread && <ThreadView thread={thread} connected={!!machines.find((machine) => machine.id === thread.machineId)?.connected} canControl={!!machines.find((machine) => machine.id === thread.machineId)?.writable} focusedPane={focusedPane} onFocusPane={setFocusedPane} windowStart={windowStart} narrow={narrow}
        pendingSplits={paneActions.pendingSplits} pendingCloses={paneActions.pendingCloses} paneActionNotice={paneActions.notice} onDismissPendingSplit={paneActions.dismissSplit} onDismissPendingClose={paneActions.dismissClose} onDismissPaneActionNotice={paneActions.dismissNotice} />}
      {page === 'thread' && !thread && threadIsAuthoritativelyMissing && <main className="not-found"><h1>Thread not found</h1><a href="/">Open a thread</a></main>}
      {page === 'thread' && !thread && !threadIsAuthoritativelyMissing && <main className="native-thread-layout is-loading" aria-label="Thread"><LoadingOrb title="Opening thread" detail="Waiting for this thread to appear…" /></main>}
      {page === 'terminal' && route.type === 'terminal' && routeMachineSession !== route.session && <main className="native-thread-layout is-loading" aria-label="Terminal tab"><LoadingOrb title="Opening terminal" detail="Waiting for this terminal tab to appear…" /></main>}
      {page === 'terminal' && route.type === 'terminal' && routeMachineSession === route.session && machineId && tabId && <TerminalTabView machineId={machineId} tabId={tabId} panes={terminalPanes} connected={!!machines.find((machine) => machine.id === machineId)?.connected} canControl={!!machines.find((machine) => machine.id === machineId)?.writable} focusedPane={focusedPane} onFocusPane={setFocusedPane} windowStart={windowStart} narrow={narrow} pending={terminalPending} missing={terminalMissing} startupPreset={pendingTerminalStartup} onStartupComplete={completeTerminalStartup} />}
      {page === 'new' && route.type === 'composer' && (route.resourcePendingKey
        ? <PendingResourceOperation key={`${tickets.resourceRecoveryScope}:${route.resourcePendingKey}`} ticketKey={route.resourcePendingKey} />
        : route.pendingKey
          ? <PendingOperation key={`${tickets.recoveryScope}:${route.pendingKey}`} ticketKey={route.pendingKey} />
          : <NewThreadView key={`${tickets.recoveryScope}:${projectId}`} projects={projects} machines={machines} selectedProjectId={projectId} workspacePendingKey={route.query.find(([key]) => key === 'workspacePending')?.[1]} onOpenSidebar={toggleSidebar} onNavigate={navigate} />)}
      {page === 'settings' && <SettingsView onOpenSidebar={toggleSidebar} />}
      {page === 'missing' && <main className="not-found"><h1>Page not available</h1><a href="/">Open Webr</a></main>}
    </div>
    {perfAvailable && <PerfOverlay />}
    <PairingPrompt />
    <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onNavigate={navigate} projects={projects} threads={threads} floating={floating} machines={machines} thread={thread} metadata={metadata} metadataFields={metadataFields} focusedPane={focusedPane} onNewTerminal={terminalMachine ? openStandaloneTerminal : undefined} onOpenResourceMonitor={terminalMachine ? () => openStandaloneTerminal('resource-monitor') : undefined}
      mode={mode} onModeChange={changeMode} onToggleSidebar={toggleSidebar} onFocusPane={setFocusedPane} onTerminalAction={(action) => { const pane = thread?.panes.find((pane) => pane.id === focusedPane); if (thread && pane?.terminalId) terminals.command(thread.machineId, thread.id, pane.terminalId, action); }}
      onOpenTerminal={openTerminal} onClosePane={() => void closePane()} />
    {armedPrefix && !paletteOpen && <PrefixOverlay prefix={armedPrefix} shortcuts={{ ...shortcuts, ...getShortcuts() }} />}
  </div>;
}
