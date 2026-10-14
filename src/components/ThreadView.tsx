import { TerminalPane } from './TerminalPane';
import type { Pane, Thread } from '../lib/models';
import { LaunchProgress } from './LaunchProgress';
import { isLaunching, launchFailed } from '../lib/launch';
import { PaneStrip, PaneTabs } from './PaneStrip';

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

export function ThreadView({ thread, connected, canControl, onFocusPane, focusedPane, windowStart, narrow }: {
  thread: Thread; connected: boolean; canControl: boolean; onFocusPane: (paneId: string) => void; focusedPane: string; windowStart: number; narrow: boolean;
}) {
  const showingLaunch = connected && (isLaunching(thread) || launchFailed(thread));
  const renderPane = (pane: Pane) => pane.terminalId ? <TerminalPane key={pane.terminalId} pane={pane} machineId={thread.machineId} threadId={thread.id} active={focusedPane === pane.id} canControl={canControl} onFocus={() => onFocusPane(pane.id)} /> : null;
  if (showingLaunch) return <LaunchProgress thread={thread} />;
  const strip = { panes: thread.panes, focusedPane, onFocusPane, renderPane };
  return <main className="native-thread-layout" aria-label={`${thread.title} tab`}>
    {!connected && <p className="runtime-notice" role="status">Disconnected; input is disabled.</p>}
    {connected && thread.bindingState !== 'attached' && <p className="runtime-notice" role="status">{detachedMessage(thread)}</p>}
    {connected && thread.bindingState === 'attached' && !canControl && <p className="runtime-notice" role="status">Terminal input is unavailable because this Herdr version is not supported.</p>}
    {connected && thread.bindingState === 'attached' && (thread.panes.length ? (narrow ? <PaneTabs {...strip} /> : <PaneStrip {...strip} windowStart={windowStart} />) : <p className="runtime-notice" role="status">No live panes are available for this thread.</p>)}
  </main>;
}
