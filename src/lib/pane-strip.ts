import type { Pane, Thread } from './models';

export const VISIBLE_PANES = 2;

const rankIn = (order: string[], id: string) => { const rank = order.indexOf(id); return rank < 0 ? Infinity : rank; };
export const orderPanes = <T extends { id: string }>(panes: T[], order: string[] = []) => [...panes].sort((a, b) => rankIn(order, a.id) - rankIn(order, b.id));
export const insertAfter = (ids: string[], afterId: string, id: string) => { const at = ids.indexOf(afterId); return at < 0 ? [...ids, id] : [...ids.slice(0, at + 1), id, ...ids.slice(at + 1)]; };
export const canClosePane = (thread: Thread, paneId: string) => thread.panes.length > 1 && thread.panes.some((pane) => pane.id === paneId && pane.kind !== 'agent');
export const neighbourPane = (panes: Pane[], paneId: string) => { const at = panes.findIndex((pane) => pane.id === paneId); return panes[at - 1] ?? panes[at + 1]; };

export function windowStartShowing(count: number, start: number, index: number, size = VISIBLE_PANES) {
  const shown = index < 0 ? start : index < start ? index : index >= start + size ? index - size + 1 : start;
  return Math.max(0, Math.min(shown, count - size));
}
