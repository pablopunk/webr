import type { Pane } from '../lib/models';
import { PaneStrip, PaneTabs } from './PaneStrip';
import { TerminalPane } from './TerminalPane';
import type { TerminalStartupPreset } from '../client/terminal-presets';
import { LoadingOrb } from './LoadingOrb';

export function TerminalTabView({ machineId, tabId, panes, connected, canControl, focusedPane, onFocusPane, windowStart, narrow, pending, missing = false, startupPreset, onStartupComplete }: {
  machineId: string; tabId: string; panes: Pane[]; connected: boolean; canControl: boolean;
  focusedPane: string; onFocusPane: (paneId: string) => void; windowStart: number; narrow: boolean;
  pending: boolean; missing?: boolean; startupPreset?: TerminalStartupPreset; onStartupComplete: () => void;
}) {
  const startupPaneId = panes.find((pane) => pane.terminalId)?.id;
  const renderPane = (pane: Pane) => pane.terminalId ? <TerminalPane key={pane.terminalId} pane={pane} machineId={machineId} tabId={tabId} active={focusedPane === pane.id} canControl={canControl} connected={connected} onFocus={() => onFocusPane(pane.id)} startupPreset={pane.id === startupPaneId ? startupPreset : undefined} onStartupComplete={onStartupComplete} /> : null;
  const strip = { panes, focusedPane, onFocusPane, renderPane };
  const waitingForTab = pending && panes.length === 0;
  return <main className={`native-thread-layout ${waitingForTab ? 'is-loading' : ''}`} aria-label="Terminal tab">
    {waitingForTab
      ? <LoadingOrb title="Opening terminal" detail={connected ? 'Waiting for this terminal tab to appear…' : 'Waiting for Herdr to reconnect before this terminal tab can appear…'} />
      : <>
        {!connected && <p className="runtime-notice" role="status">Disconnected; input is disabled.</p>}
        {panes.length ? (narrow ? <PaneTabs {...strip} /> : <PaneStrip {...strip} windowStart={windowStart} />) : connected && <p className="runtime-notice" role="status">{missing ? 'Terminal tab not found.' : 'No live terminal panes are available.'}</p>}
      </>}
  </main>;
}
