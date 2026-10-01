import { TerminalPane } from './TerminalPane';
import type { Thread } from '../lib/models';
import type { Layout } from '../shared/runtime';

export function ThreadView({ thread, layouts, connected, onFocusPane, focusedPane }: {
  thread: Thread; layouts: Layout[]; connected: boolean; onFocusPane: (paneId: string) => void; focusedPane: string;
}) {
  const visibleLayouts = layouts.filter((layout) => layout.panes.some((rect) => thread.panes.some((pane) => pane.id === rect.paneId)));
  return <main className="native-thread-layout" aria-label={`${thread.title} tab`}>
    {(!connected || thread.bindingState !== 'attached') && <p className="runtime-notice" role="status">{!connected ? 'Disconnected; input is disabled.' : thread.bindingState === 'detached' ? 'The saved terminal is not present; explicit adoption is required.' : `Launch ${thread.operation?.state ?? 'pending'}: ${thread.operation?.step ?? 'validate'}`}</p>}
    {thread.operation?.state === 'unknown' && <p className="runtime-notice" role="alert">The launch result is unknown; inspect the target before you try again.</p>}
    {connected && thread.bindingState === 'attached' && visibleLayouts.map((layout) => <div className="native-pane-layout" key={`${layout.workspaceId}:${layout.tabId}`}>
      {thread.panes.map((pane) => {
        const rect = layout.panes.find((rect) => rect.paneId === pane.id)?.rect;
        if (!rect || !layout.area.width || !layout.area.height) return null;
        return <div key={`${pane.id}:${pane.terminalId}`} className="native-pane-position" style={{ left: `${(rect.x - layout.area.x) / layout.area.width * 100}%`, top: `${(rect.y - layout.area.y) / layout.area.height * 100}%`, width: `${rect.width / layout.area.width * 100}%`, height: `${rect.height / layout.area.height * 100}%` }}><TerminalPane pane={pane} machineId={thread.machineId} threadId={thread.id} active={focusedPane === pane.id} onFocus={() => onFocusPane(pane.id)} /></div>;
      })}
    </div>)}
  </main>;
}
