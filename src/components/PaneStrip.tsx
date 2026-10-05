import { useDeferredValue, ViewTransition, type ReactNode } from 'react';
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

const stripShape = (panes: Pane[], windowStart: number) => JSON.stringify([windowStart, panes.map((pane) => pane.id)]);
const panesInShape = (shape: string, panes: Pane[]) => { const [start, ids] = JSON.parse(shape) as [number, string[]]; return { start, panes: ids.flatMap((id) => panes.filter((pane) => pane.id === id)) }; };

/** Only a change of order or window runs as a transition, because a view transition covers the live terminals with snapshots while it animates. */
const useAnimatedShape = (panes: Pane[], windowStart: number) => panesInShape(useDeferredValue(stripShape(panes, windowStart)), panes);

export function PaneStrip({ panes: livePanes, windowStart: liveStart, onFocusPane, renderPane }: StripProps) {
  const { panes, start } = useAnimatedShape(livePanes, liveStart);
  const isVisible = (index: number) => index >= start && index < start + VISIBLE_PANES;
  return <div className={`pane-strip ${panes.length > 1 ? 'is-split' : ''}`}>
    {panes.map((pane, index) => <ViewTransition key={pane.id} default="pane-move" enter="pane-enter" exit="pane-exit">
      {isVisible(index)
        ? <div className="pane-slot">{renderPane(pane)}</div>
        : <CollapsedPane pane={pane} side={index < start ? 'left' : 'right'} onOpen={() => onFocusPane(pane.id)} />}
    </ViewTransition>)}
  </div>;
}

export function PaneTabs({ panes, focusedPane, onFocusPane, renderPane }: Omit<StripProps, 'windowStart'>) {
  const shownId = useDeferredValue(focusedPane);
  const shown = panes.find((pane) => pane.id === shownId) ?? panes[0];
  return <div className="pane-tabbed">
    {panes.length > 1 && <div className="pane-tabs" role="tablist" aria-label="Panes">
      {panes.map((pane) => <button key={pane.id} type="button" role="tab" aria-selected={pane.id === shown?.id} className="pane-tab" onClick={() => onFocusPane(pane.id)}><PaneIcon pane={pane} /><span>{pane.title}</span></button>)}
    </div>}
    {shown && <ViewTransition key={shown.id} enter="pane-enter" exit="pane-exit"><div className="pane-slot" role="tabpanel">{renderPane(shown)}</div></ViewTransition>}
  </div>;
}
