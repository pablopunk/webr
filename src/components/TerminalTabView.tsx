import type { Pane } from '../lib/models';
import { PaneStrip, PaneTabs } from './PaneStrip';
import { TerminalPane } from './TerminalPane';
import type { TerminalStartupPreset } from '../client/terminal-presets';

export function TerminalTabView({ machineId, tabId, panes, connected, canControl, focusedPane, onFocusPane, windowStart, narrow, pending, missing = false, startupPreset, onStartupComplete }: {
  machineId: string; tabId: string; panes: Pane[]; connected: boolean; canControl: boolean;
  focusedPane: string; onFocusPane: (paneId: string) => void; windowStart: number; narrow: boolean;
  pending: boolean; missing?: boolean; startupPreset?: TerminalStartupPreset; onStartupComplete: () => void;
}) {
  const startupPaneId = panes.find((pane) => pane.terminalId)?.id;
  const renderPane = (pane: Pane) => pane.terminalId ? <TerminalPane key={pane.terminalId} pane={pane} machineId={machineId} tabId={tabId} active={focusedPane === pane.id} canControl={canControl} onFocus={() => onFocusPane(pane.id)} startupPreset={pane.id === startupPaneId ? startupPreset : undefined} onStartupComplete={onStartupComplete} /> : null;
  const strip = { panes, focusedPane, onFocusPane, renderPane };
  return <main className="native-thread-layout" aria-label="Terminal tab">
    {!connected && <p className="runtime-notice" role="status">{pending ? 'Waiting for this terminal tab to appear; input is disabled until this Herdr reconnects.' : 'Disconnected; input is disabled.'}</p>}
    {connected && (panes.length ? (narrow ? <PaneTabs {...strip} /> : <PaneStrip {...strip} windowStart={windowStart} />) : <p className="runtime-notice" role="status">{pending ? 'Waiting for this terminal tab to appear…' : missing ? 'Terminal tab not found.' : 'No live terminal panes are available.'}</p>)}
  </main>;
}
