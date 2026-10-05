import type { ReactNode } from 'react';
import { Bot, TerminalSquare } from 'lucide-react';
import type { Pane } from '../lib/models';
import { VISIBLE_PANES } from '../lib/pane-strip';
import { Tooltip } from './Tooltip';

type StripProps = { panes: Pane[]; focusedPane: string; windowStart: number; onFocusPane: (paneId: string) => void; renderPane: (pane: Pane) => ReactNode };

const PaneIcon = ({ pane }: { pane: Pane }) => pane.kind === 'agent' ? <Bot size={14} strokeWidth={1.8} aria-hidden="true" /> : <TerminalSquare size={14} strokeWidth={1.8} aria-hidden="true" />;

function CollapsedPane({ pane, side, onOpen }: { pane: Pane; side: 'left' | 'right'; onOpen: () => void }) {
  return <Tooltip label={`Show ${pane.title}`} side={side === 'left' ? 'right' : 'left'}><button type="button" className="pane-collapsed" aria-label={`Show ${pane.title}`} onClick={onOpen}>
    <PaneIcon pane={pane} /><span>{pane.title}</span>
  </button></Tooltip>;
}

export function PaneStrip({ panes, windowStart, onFocusPane, renderPane }: StripProps) {
  const isVisible = (index: number) => index >= windowStart && index < windowStart + VISIBLE_PANES;
  return <div className={`pane-strip ${panes.length > 1 ? 'is-split' : ''}`}>
    {panes.map((pane, index) => isVisible(index)
      ? <div key={pane.id} className="pane-slot">{renderPane(pane)}</div>
      : <CollapsedPane key={pane.id} pane={pane} side={index < windowStart ? 'left' : 'right'} onOpen={() => onFocusPane(pane.id)} />)}
  </div>;
}

export function PaneTabs({ panes, focusedPane, onFocusPane, renderPane }: Omit<StripProps, 'windowStart'>) {
  const shown = panes.find((pane) => pane.id === focusedPane) ?? panes[0];
  return <div className="pane-tabbed">
    {panes.length > 1 && <div className="pane-tabs" role="tablist" aria-label="Panes">
      {panes.map((pane) => <button key={pane.id} type="button" role="tab" aria-selected={pane.id === shown?.id} className="pane-tab" onClick={() => onFocusPane(pane.id)}><PaneIcon pane={pane} /><span>{pane.title}</span></button>)}
    </div>}
    {shown && <div key={shown.id} className="pane-slot" role="tabpanel">{renderPane(shown)}</div>}
  </div>;
}
