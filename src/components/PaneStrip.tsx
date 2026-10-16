import { useDeferredValue, ViewTransition, type ReactNode } from 'react';
import { Bot, TerminalSquare } from 'lucide-react';
import type { PendingPaneSplit } from '../client/pending-pane-actions';
import type { Pane } from '../lib/models';
import { VISIBLE_PANES } from '../lib/pane-strip';
import { Tooltip } from './Tooltip';

type StripProps = {
  panes: Pane[];
  focusedPane: string;
  windowStart: number;
  onFocusPane: (paneId: string) => void;
  renderPane: (pane: Pane) => ReactNode;
  pendingSplits?: PendingPaneSplit[];
  onDismissPendingSplit?: (key: string) => void;
};
type StripItem = { key: string; kind: 'pane'; pane: Pane } | { key: string; kind: 'pending'; pending: PendingPaneSplit };

export const PaneIcon = ({ pane }: { pane: Pane }) => pane.kind === 'agent' ? <Bot size={14} strokeWidth={1.8} aria-hidden="true" /> : <TerminalSquare size={14} strokeWidth={1.8} aria-hidden="true" />;

function CollapsedPane({ pane, side, onOpen }: { pane: Pane; side: 'left' | 'right'; onOpen: () => void }) {
  return <Tooltip label={`Show ${pane.title}`} side={side === 'left' ? 'right' : 'left'}><button type="button" className="pane-collapsed" aria-label={`Show ${pane.title}`} onClick={onOpen}>
    <PaneIcon pane={pane} /><span>{pane.title}</span>
  </button></Tooltip>;
}

function PendingSplitSlot({ pending, onDismiss }: { pending: PendingPaneSplit; onDismiss?: (key: string) => void }) {
  const label = pending.message;
  const dismissible = pending.phase === 'awaiting' || pending.phase === 'uncertain';
  return <div className={`pane-slot pending-pane-slot ${pending.phase === 'pending' ? 'is-loading' : ''}`} role="status" aria-live="polite" aria-busy={pending.phase === 'pending' ? true : undefined}>
    <div className="pending-pane-card">
      <span className="pending-pane-skeleton" aria-hidden="true" />
      <span>{label}</span>
      {dismissible && onDismiss && <button type="button" className="pending-pane-dismiss" aria-label="Dismiss split status" onClick={() => onDismiss(pending.key)}>Dismiss</button>}
    </div>
  </div>;
}

const itemKey = (item: StripItem) => item.key;
const stripShape = (items: StripItem[], windowStart: number) => JSON.stringify([windowStart, items.map(itemKey)]);
const itemsInShape = (shape: string, items: StripItem[]) => {
  const [start, keys] = JSON.parse(shape) as [number, string[]];
  const byKey = new Map(items.map((item) => [item.key, item]));
  return { start, items: keys.flatMap((key) => { const item = byKey.get(key); return item ? [item] : []; }) };
};

/** Only a change of order or window runs as a transition, because a view transition covers the live terminals with snapshots while it animates. */
const useAnimatedItems = (items: StripItem[], windowStart: number) => itemsInShape(useDeferredValue(stripShape(items, windowStart)), items);
function displayItems(panes: Pane[], pendingSplits: PendingPaneSplit[]): StripItem[] {
  const bySource = new Map<string, PendingPaneSplit[]>();
  for (const pending of pendingSplits) bySource.set(pending.afterPaneId, [...(bySource.get(pending.afterPaneId) ?? []), pending]);
  const result: StripItem[] = [];
  for (const pane of panes) {
    result.push({ key: `pane:${pane.id}`, kind: 'pane', pane });
    for (const pending of bySource.get(pane.id) ?? []) result.push({ key: `pending:${pending.key}`, kind: 'pending', pending });
    bySource.delete(pane.id);
  }
  for (const pending of bySource.values()) for (const item of pending) result.push({ key: `pending:${item.key}`, kind: 'pending', pending: item });
  return result;
}

export function PaneStrip({ panes: livePanes, windowStart: liveStart, onFocusPane, renderPane, pendingSplits = [], onDismissPendingSplit }: StripProps) {
  const { items, start } = useAnimatedItems(displayItems(livePanes, pendingSplits), liveStart);
  let paneIndex = -1;
  return <div className={`pane-strip ${items.length > 1 ? 'is-split' : ''}`}>
    {items.map((item) => {
      if (item.kind === 'pending') return <ViewTransition key={item.key} default="pane-move" enter="pane-enter" exit="pane-exit"><PendingSplitSlot pending={item.pending} onDismiss={onDismissPendingSplit} /></ViewTransition>;
      const index = ++paneIndex;
      const isVisible = index >= start && index < start + VISIBLE_PANES;
      return <ViewTransition key={item.key} default="pane-move" enter="pane-enter" exit="pane-exit">
        {isVisible
          ? <div className="pane-slot">{renderPane(item.pane)}</div>
          : <CollapsedPane pane={item.pane} side={index < start ? 'left' : 'right'} onOpen={() => onFocusPane(item.pane.id)} />}
      </ViewTransition>;
    })}
  </div>;
}

export function PaneTabs({ panes, focusedPane, renderPane, pendingSplits = [], onDismissPendingSplit }: Omit<StripProps, 'windowStart' | 'onFocusPane'>) {
  const shownId = useDeferredValue(focusedPane);
  const shown = panes.find((pane) => pane.id === shownId) ?? panes[0];
  return <div className="pane-tabbed">
    {shown && <ViewTransition key={shown.id} enter="pane-enter" exit="pane-exit"><div className="pane-slot" role="tabpanel">{renderPane(shown)}</div></ViewTransition>}
    {pendingSplits.map((pending) => <PendingSplitSlot key={pending.key} pending={pending} onDismiss={onDismissPendingSplit} />)}
  </div>;
}
