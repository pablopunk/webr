import type { Pane } from '../lib/models';
import { PaneStrip, PaneTabs } from './PaneStrip';
import { TerminalPane } from './TerminalPane';

export function TerminalTabView({ machineId, tabId, panes, connected, canControl, focusedPane, onFocusPane, windowStart, narrow }: {
  machineId: string; tabId: string; panes: Pane[]; connected: boolean; canControl: boolean;
  focusedPane: string; onFocusPane: (paneId: string) => void; windowStart: number; narrow: boolean;
}) {
  const renderPane = (pane: Pane) => pane.terminalId ? <TerminalPane key={pane.terminalId} pane={pane} machineId={machineId} tabId={tabId} active={focusedPane === pane.id} canControl={canControl} onFocus={() => onFocusPane(pane.id)} /> : null;
  const strip = { panes, focusedPane, onFocusPane, renderPane };
  return <main className="native-thread-layout" aria-label="Terminal tab">
    {!connected && <p className="runtime-notice" role="status">Disconnected; input is disabled.</p>}
    {connected && (panes.length ? (narrow ? <PaneTabs {...strip} /> : <PaneStrip {...strip} windowStart={windowStart} />) : <p className="runtime-notice" role="status">No live terminal panes are available.</p>)}
  </main>;
}
