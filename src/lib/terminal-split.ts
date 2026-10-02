import type { Pane, Thread } from './models';
import type { Layout, Rect } from '../shared/runtime';

export type PeekSide = 'right' | 'bottom';
export const threadAgent = (thread: Thread): Pane | undefined => thread.panes.find((pane) => pane.kind === 'agent') ?? thread.panes[0];
export const threadShell = (thread: Thread): Pane | undefined => { const main = threadAgent(thread); return thread.panes.find((pane) => pane.kind === 'shell' && pane.id !== main?.id); };
export const peekSide = (shell: Rect, area: Rect): PeekSide => shell.x > area.x && shell.y === area.y ? 'right' : 'bottom';
export const terminalDirection = (side: PeekSide) => side === 'right' ? 'right' as const : 'down' as const;

export function hiddenTerminalLayout(thread: Thread, layout: Layout) {
  const shell = threadShell(thread); const agent = threadAgent(thread);
  const shellRect = shell && layout.panes.find((rect) => rect.paneId === shell.id)?.rect;
  const otherPanes = thread.panes.filter((pane) => pane.id !== shell?.id && pane.id !== agent?.id);
  if (!thread.terminalHidden || !shell || !agent || !shellRect || otherPanes.length) return undefined;
  return { shell, agent, side: peekSide(shellRect, layout.area) };
}

export function currentTerminalDirection(thread: Thread, layouts: Layout[], narrow: boolean) {
  const shell = threadShell(thread);
  const layout = layouts.find((layout) => layout.panes.some((rect) => rect.paneId === shell?.id));
  const rect = layout?.panes.find((rect) => rect.paneId === shell?.id)?.rect;
  return rect && layout ? terminalDirection(peekSide(rect, layout.area)) : narrow ? 'down' : 'right';
}
