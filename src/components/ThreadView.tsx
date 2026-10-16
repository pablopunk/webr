import { TerminalPane } from './TerminalPane';
import type { Pane, Thread } from '../lib/models';
import { LaunchProgress } from './LaunchProgress';
import { isLaunching, launchFailed } from '../lib/launch';
import { PaneStrip, PaneTabs } from './PaneStrip';
import { threadDisplayTitle } from '../client/pending-metadata';
import type { PaneActionNotice, PendingPaneClose, PendingPaneSplit } from '../client/pending-pane-actions';

const DETACHED_MESSAGES: Record<string, string> = {
  worktree_changed: 'The agent moved to a different repository or location, so this thread is detached.',
  worktree_unverified: 'The worktree for this thread could not be verified.',
  conversation_changed: 'The conversation in this tab changed, so this thread is detached.',
  conversation_conflict: 'Several tabs report this conversation, so this thread is detached.',
  owner_conflict: 'Several tabs claim this thread, so it is detached.',
  binding_conflict: 'Another thread already uses this tab.',
  agent_changed: 'A different agent is running in this tab.',
  target_changed: 'The Herdr target changed since this thread was created.',
};
const detachedMessage = (thread: Thread) => DETACHED_MESSAGES[thread.recovery?.reason ?? ''] ?? 'No live panes are available for this thread.';

export function ThreadView({ thread, connected, canControl, onFocusPane, focusedPane, windowStart, narrow, pendingSplits = [], pendingCloses = [], paneActionNotice, onDismissPendingSplit, onDismissPendingClose, onDismissPaneActionNotice }: {
  thread: Thread; connected: boolean; canControl: boolean; onFocusPane: (paneId: string) => void; focusedPane: string; windowStart: number; narrow: boolean;
  pendingSplits?: PendingPaneSplit[]; pendingCloses?: PendingPaneClose[]; paneActionNotice?: PaneActionNotice;
  onDismissPendingSplit?: (key: string) => void; onDismissPendingClose?: (key: string) => void; onDismissPaneActionNotice?: () => void;
}) {
  const showingLaunch = connected && (isLaunching(thread) || launchFailed(thread));
  const confirmedClosed = pendingCloses.filter((pending) => pending.phase === 'confirmed');
  const panes = thread.panes.filter((pane) => !confirmedClosed.some((pending) => pending.paneId === pane.id || pending.terminalId === pane.terminalId));
  const renderPane = (pane: Pane) => {
    if (!pane.terminalId) return null;
    const closing = pendingCloses.find((pending) => (pending.paneId === pane.id || pending.terminalId === pane.terminalId) && pending.phase !== 'confirmed');
    return <>
      <TerminalPane key={pane.terminalId} pane={pane} machineId={thread.machineId} threadId={thread.id} active={focusedPane === pane.id} canControl={canControl} connected={connected} onFocus={() => onFocusPane(pane.id)} />
      {closing && <div className={`pane-action-overlay is-${closing.phase}`} role="status" aria-live="polite">
        <span>{closing.message}</span>
        {closing.phase === 'uncertain' && onDismissPendingClose && <button type="button" className="pending-pane-dismiss" aria-label="Dismiss close status" onClick={() => onDismissPendingClose(closing.key)}>Dismiss</button>}
      </div>}
    </>;
  };
  if (showingLaunch) return <LaunchProgress thread={thread} />;
  const strip = { panes, focusedPane, onFocusPane, renderPane, pendingSplits, onDismissPendingSplit };
  return <main className="native-thread-layout" aria-label={`${threadDisplayTitle(thread)} tab`}>
    {!connected && <p className="runtime-notice" role="status">Disconnected; input is disabled.</p>}
    {connected && thread.bindingState !== 'attached' && <p className="runtime-notice" role="status">{detachedMessage(thread)}</p>}
    {paneActionNotice && <p className="pane-action-notice" role="alert">{paneActionNotice.message}{onDismissPaneActionNotice && <button type="button" className="pending-pane-dismiss" onClick={onDismissPaneActionNotice}>Dismiss</button>}</p>}
    {connected && thread.bindingState === 'attached' && !canControl && <p className="runtime-notice" role="status">Terminal input is unavailable because this Herdr version is not supported.</p>}
    {thread.bindingState === 'attached' && (panes.length ? (narrow ? <PaneTabs {...strip} /> : <PaneStrip {...strip} windowStart={windowStart} />) : connected && <p className="runtime-notice" role="status">No live panes are available for this thread.</p>)}
  </main>;
}
