import { Command, PanelLeft } from 'lucide-react';
import type { Pane } from '../lib/models';
import { PaneIcon } from './PaneStrip';

type Props = { panes: Pane[]; focusedPane: string; onFocusPane: (paneId: string) => void; onOpenSidebar: () => void; onOpenPalette: () => void; keepTerminalFocus: (event: React.SyntheticEvent) => void };

const selectedPaneId = (panes: Pane[], focusedPane: string) => (panes.find((pane) => pane.id === focusedPane) ?? panes[0])?.id;

export function MobileTopBar({ panes, focusedPane, onFocusPane, onOpenSidebar, onOpenPalette, keepTerminalFocus }: Props) {
  const selectedId = selectedPaneId(panes, focusedPane);
  return <header className="mobile-top-bar">
    <button type="button" aria-label="Open sidebar" onPointerDown={keepTerminalFocus} onClick={onOpenSidebar}><PanelLeft size={20} /></button>
    <button type="button" aria-label="Open command palette" onPointerDown={keepTerminalFocus} onClick={onOpenPalette}><Command size={20} /></button>
    <div className="mobile-top-tabs" role="tablist" aria-label="Panes">
      {panes.length ? panes.map((pane) => <button key={pane.id} type="button" role="tab" aria-selected={pane.id === selectedId} className="pane-tab" onClick={() => onFocusPane(pane.id)}><PaneIcon pane={pane} /><span>{pane.title}</span></button>) : <button type="button" role="tab" aria-selected="true" className="pane-tab"><span>Terminal</span></button>}
    </div>
  </header>;
}
