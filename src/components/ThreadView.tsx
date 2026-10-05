import { TerminalPane } from './TerminalPane';
import type { Pane, Thread } from '../lib/models';
import { useEffect } from 'react';
import { navigate } from 'astro:transitions/client';
import { LaunchProgress } from './LaunchProgress';
import { isLaunching, launchFailed } from '../lib/launch';
import { PaneStrip, PaneTabs } from './PaneStrip';

export function ThreadView({ thread, connected, canControl, onFocusPane, focusedPane, windowStart, narrow }: {
  thread: Thread; connected: boolean; canControl: boolean; onFocusPane: (paneId: string) => void; focusedPane: string; windowStart: number; narrow: boolean;
}) {
  const showingLaunch = connected && (isLaunching(thread) || launchFailed(thread));
  const detached = connected && thread.bindingState === 'detached' && !showingLaunch;
  useEffect(() => { if (detached) void navigate(`/new?project=${encodeURIComponent(thread.projectId)}`); }, [detached, thread.projectId]);
  const renderPane = (pane: Pane) => pane.terminalId ? <TerminalPane key={pane.terminalId} pane={pane} machineId={thread.machineId} threadId={thread.id} active={focusedPane === pane.id} canControl={canControl} onFocus={() => onFocusPane(pane.id)} /> : null;
  if (showingLaunch) return <LaunchProgress thread={thread} />;
  const strip = { panes: thread.panes, focusedPane, onFocusPane, renderPane };
  return <main className="native-thread-layout" aria-label={`${thread.title} tab`}>
    {(!connected || thread.bindingState !== 'attached') && <p className="runtime-notice" role="status">{!connected ? 'Disconnected; input is disabled.' : 'Waiting for the terminal to attach…'}</p>}
    {connected && thread.bindingState === 'attached' && !canControl && <p className="runtime-notice" role="status">Terminal input is unavailable because this Herdr version is not supported.</p>}
    {connected && thread.bindingState === 'attached' && (narrow ? <PaneTabs {...strip} /> : <PaneStrip {...strip} windowStart={windowStart} />)}
  </main>;
}
