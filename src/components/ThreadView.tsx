import type { CSSProperties } from 'react';
import { TerminalPane } from './TerminalPane';
import type { Thread } from '../lib/models';
import type { Layout, Projection } from '../shared/runtime';
import { AdoptTab } from './AdoptTab';
import { LaunchProgress } from './LaunchProgress';
import { isLaunching, launchFailed } from '../lib/launch';
import { hiddenTerminalLayout, type PeekSide } from '../lib/terminal-split';
import { TerminalSquare } from 'lucide-react';

const PEEK_SIZE = '28px';
const besidePeek = (side: PeekSide) => side === 'right' ? { left: 0, top: 0, width: `calc(100% - ${PEEK_SIZE})`, height: '100%' } : { left: 0, top: 0, width: '100%', height: `calc(100% - ${PEEK_SIZE})` };

function TerminalPeek({ side, onOpen }: { side: PeekSide; onOpen: () => void }) {
  return <button type="button" className={`terminal-peek is-${side}`} aria-label="Show terminal" title="Show terminal" onClick={onOpen}>
    <TerminalSquare size={14} strokeWidth={1.8} aria-hidden="true" /><span>Terminal</span>
  </button>;
}

export function ThreadView({ thread, layouts, tabs, connected, canControl, onFocusPane, focusedPane, onToggleTerminal }: {
  thread: Thread; layouts: Layout[]; tabs: NonNullable<Projection['availableTabs']>; connected: boolean; canControl: boolean; onFocusPane: (paneId: string) => void; focusedPane: string; onToggleTerminal: () => void;
}) {
  const pane = (item: Thread['panes'][number], style: CSSProperties) => <div key={`${item.id}:${item.terminalId}`} className="native-pane-position" style={style}><TerminalPane pane={item} machineId={thread.machineId} threadId={thread.id} active={focusedPane === item.id} canControl={canControl} onFocus={() => onFocusPane(item.id)} /></div>;
  if (connected && (isLaunching(thread) || launchFailed(thread))) return <LaunchProgress thread={thread} />;
  const visibleLayouts = layouts.filter((layout) => layout.panes.some((rect) => thread.panes.some((pane) => pane.id === rect.paneId)));
  return <main className="native-thread-layout" aria-label={`${thread.title} tab`}>
    {(!connected || thread.bindingState !== 'attached') && <p className="runtime-notice" role="status">{!connected ? 'Disconnected; input is disabled.' : thread.bindingState === 'detached' ? 'The saved terminal is not present; explicit adoption is required.' : 'Waiting for the terminal to attach…'}</p>}
    {connected && thread.bindingState === 'attached' && !canControl && <p className="runtime-notice" role="status">Terminal input is unavailable because this Herdr version is not supported.</p>}
    {connected && thread.bindingState === 'detached' && <AdoptTab key={thread.id} thread={thread} tabs={tabs} />}
    {connected && thread.bindingState === 'attached' && visibleLayouts.map((layout) => {
      const hidden = hiddenTerminalLayout(thread, layout);
      return <div className="native-pane-layout" key={`${layout.workspaceId}:${layout.tabId}`}>
        {hidden ? [pane(hidden.agent, besidePeek(hidden.side)), <TerminalPeek key="terminal-peek" side={hidden.side} onOpen={onToggleTerminal} />] : thread.panes.map((item) => {
          const rect = layout.panes.find((rect) => rect.paneId === item.id)?.rect;
          if (!rect || !layout.area.width || !layout.area.height) return null;
          return pane(item, { left: `${(rect.x - layout.area.x) / layout.area.width * 100}%`, top: `${(rect.y - layout.area.y) / layout.area.height * 100}%`, width: `${rect.width / layout.area.width * 100}%`, height: `${rect.height / layout.area.height * 100}%` });
        })}
      </div>;
    })}
  </main>;
}
