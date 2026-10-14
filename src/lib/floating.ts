import type { Projection } from '../shared/runtime';
import type { Thread } from './models';

export type FloatingTab = {
  machineId: string;
  session: string;
  tabId: string;
  workspaceId: string;
  label: string;
  paneCount: number;
  panes: { id: string; terminalId: string; title: string }[];
};

export const sidebarTabKey = (machineId: string, tabId: string) => `${machineId}:${tabId}`;

// Memoized by input identity: zustand selectors re-evaluate on every render,
// so a fresh array here would look like a store change and re-render forever.
const floatingCache = new WeakMap<Record<string, Projection> | Projection[], Map<string, FloatingTab[]>>();

/** Live Herdr tabs with no attached thread and at least one pane. */
export function floatingTabsFromProjections(
  projections: Record<string, Projection> | Projection[],
  sessions: Record<string, string> = {},
): FloatingTab[] {
  const sessionKey = JSON.stringify(sessions);
  let bySessions = floatingCache.get(projections);
  if (!bySessions) { bySessions = new Map(); floatingCache.set(projections, bySessions); }
  const cached = bySessions.get(sessionKey);
  if (cached) return cached;
  const computed = computeFloatingTabs(projections, sessions);
  bySessions.set(sessionKey, computed);
  return computed;
}

function computeFloatingTabs(
  projections: Record<string, Projection> | Projection[],
  sessions: Record<string, string>,
): FloatingTab[] {
  const list = Array.isArray(projections) ? projections : Object.values(projections);
  return list.flatMap((projection) => (projection?.availableTabs ?? [])
    .filter((tab) => !!tab && typeof tab.tabId === 'string' && !tab.bound && Array.isArray(tab.panes) && tab.panes.length > 0)
    .map((tab) => ({
      machineId: projection.machineId,
      session: projection.machine?.session ?? sessions[projection.machineId] ?? '',
      tabId: tab.tabId,
      workspaceId: tab.workspaceId,
      label: tab.label ?? tab.tabId,
      paneCount: tab.panes.length,
      panes: tab.panes,
    }))).sort((a, b) => (a.label ?? '').localeCompare(b.label ?? '') || (a.tabId ?? '').localeCompare(b.tabId ?? ''));
}

/** Agent-present means the tab currently runs an agent surface. Idle/done alone never demotes. */
export function tabHasAgentPanes(tabId: string, machineId: string, threads: Thread[]): boolean {
  const thread = threads.find((item) => item.machineId === machineId && item.tabId === tabId && item.bindingState === 'attached');
  if (!thread) return false;
  return thread.panes.some((pane) => pane.kind === 'agent');
}

export type FlipNav =
  | { to: 'thread'; threadId: string }
  | { to: 'terminal'; session: string; machineId: string; tabId: string }
  | { to: null };

/**
 * Decide redirect when the currently viewed item flips mode.
 * Returns null when no navigation is needed.
 */
export function decideFlipNavigation(args: {
  page: 'thread' | 'terminal' | 'new' | 'settings' | 'missing';
  viewedThreadId?: string;
  viewedMachineId?: string;
  viewedTabId?: string;
  threads: Thread[];
  floating: FloatingTab[];
  launchingOrRestoring: boolean;
}): FlipNav {
  if (args.launchingOrRestoring) return { to: null };
  if (args.page === 'terminal' && args.viewedMachineId && args.viewedTabId) {
    const promoted = args.threads.find((item) => item.machineId === args.viewedMachineId && item.tabId === args.viewedTabId && item.bindingState === 'attached' && item.panes.some((pane) => pane.kind === 'agent'));
    if (promoted) return { to: 'thread', threadId: promoted.id };
  }
  if (args.page === 'thread' && args.viewedThreadId) {
    const thread = args.threads.find((item) => item.id === args.viewedThreadId);
    if (!thread) return { to: null };
    const demoted = thread.bindingState === 'attached' && !thread.panes.some((pane) => pane.kind === 'agent');
    if (demoted) {
      const tab = args.floating.find((item) => item.machineId === thread.machineId && item.tabId === thread.tabId);
      if (tab) return { to: 'terminal', session: tab.session, machineId: tab.machineId, tabId: tab.tabId };
    }
  }
  return { to: null };
}
