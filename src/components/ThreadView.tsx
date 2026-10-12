import { TerminalPane } from './TerminalPane';
import type { Pane, Thread } from '../lib/models';
import { LaunchProgress } from './LaunchProgress';
import { isLaunching, launchFailed } from '../lib/launch';
import { PaneStrip, PaneTabs } from './PaneStrip';
import { ThreadRecoveryNotice } from './ThreadRecovery';

export function ThreadView({ thread, connected, canControl, onFocusPane, focusedPane, windowStart, narrow }: {
  thread: Thread; connected: boolean; canControl: boolean; onFocusPane: (paneId: string) => void; focusedPane: string; windowStart: number; narrow: boolean;
}) {
  const showingLaunch = connected && (isLaunching(thread) || launchFailed(thread));
  const renderPane = (pane: Pane) => pane.terminalId ? <TerminalPane key={pane.terminalId} pane={pane} machineId={thread.machineId} threadId={thread.id} active={focusedPane === pane.id} canControl={canControl} onFocus={() => onFocusPane(pane.id)} /> : null;
  if (showingLaunch) return <LaunchProgress thread={thread} />;
  const strip = { panes: thread.panes, focusedPane, onFocusPane, renderPane };
  return <main className="native-thread-layout" aria-label={`${thread.title} tab`}>
    <ThreadRecoveryNotice thread={thread} />
    {(!connected || thread.bindingState !== 'attached') && <p className="runtime-notice" role="status">{!connected ? 'Disconnected; input is disabled. The saved thread remains available.' : 'The saved thread is not attached to a live Herdr pane. It remains here while recovery is checked.'}</p>}
    {connected && thread.bindingState === 'attached' && !canControl && <p className="runtime-notice" role="status">Terminal input is unavailable because this Herdr version is not supported.</p>}
    {connected && thread.bindingState === 'attached' && (thread.panes.length ? (narrow ? <PaneTabs {...strip} /> : <PaneStrip {...strip} windowStart={windowStart} />) : <p className="runtime-notice" role="status">No live panes are available for this saved thread.</p>)}
  </main>;
}
