import { TerminalPane } from './TerminalPane';
import type { Pane, Thread } from '../lib/models';
import type { Projection } from '../shared/runtime';
import { AdoptTab } from './AdoptTab';
import { LaunchProgress } from './LaunchProgress';
import { isLaunching, launchFailed } from '../lib/launch';
import { PaneStrip, PaneTabs } from './PaneStrip';

export function ThreadView({ thread, tabs, connected, canControl, onFocusPane, focusedPane, windowStart, narrow }: {
  thread: Thread; tabs: NonNullable<Projection['availableTabs']>; connected: boolean; canControl: boolean; onFocusPane: (paneId: string) => void; focusedPane: string; windowStart: number; narrow: boolean;
}) {
  const renderPane = (pane: Pane) => pane.terminalId ? <TerminalPane key={pane.terminalId} pane={pane} machineId={thread.machineId} threadId={thread.id} active={focusedPane === pane.id} canControl={canControl} onFocus={() => onFocusPane(pane.id)} /> : null;
  if (connected && (isLaunching(thread) || launchFailed(thread))) return <LaunchProgress thread={thread} />;
  const strip = { panes: thread.panes, focusedPane, onFocusPane, renderPane };
  return <main className="native-thread-layout" aria-label={`${thread.title} tab`}>
    {(!connected || thread.bindingState !== 'attached') && <p className="runtime-notice" role="status">{!connected ? 'Disconnected; input is disabled.' : thread.bindingState === 'detached' ? 'The saved terminal is not present; explicit adoption is required.' : 'Waiting for the terminal to attach…'}</p>}
    {connected && thread.bindingState === 'attached' && !canControl && <p className="runtime-notice" role="status">Terminal input is unavailable because this Herdr version is not supported.</p>}
    {connected && thread.bindingState === 'detached' && <AdoptTab key={thread.id} thread={thread} tabs={tabs} />}
    {connected && thread.bindingState === 'attached' && (narrow ? <PaneTabs {...strip} /> : <PaneStrip {...strip} windowStart={windowStart} />)}
  </main>;
}
