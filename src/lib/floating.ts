import type { Projection } from '../shared/runtime';
import type { Thread } from './models';
import { isLaunchTransitional, isListedThread } from './launch';

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

export type SidebarPartition = { listed: Thread[]; detached: Thread[]; terminals: FloatingTab[]; ownedTabs: Map<string, FloatingTab> };

const tabKeyOf = (thread: Thread) => sidebarTabKey(thread.machineId, thread.tabId);

/**
 * Every live Herdr tab appears exactly once: as its owning thread's row, or as a terminal row.
 * An owning thread is attached, or detached while its saved tab is still live. Threads without
 * a live tab and not launching are detached and never become a row that opens nothing.
 */
export function partitionSidebar(threads: Thread[], unboundTabs: FloatingTab[], now = Date.now()): SidebarPartition {
  const liveTabs = new Map(unboundTabs.map((tab) => [sidebarTabKey(tab.machineId, tab.tabId), tab]));
  const candidates = threads.filter((thread) => isListedThread(thread, now));
  const owners = new Map<string, Thread>();
  for (const thread of candidates) {
    if (thread.bindingState === 'attached' || !thread.tabId || !liveTabs.has(tabKeyOf(thread))) continue;
    const incumbent = owners.get(tabKeyOf(thread));
    if (!incumbent || thread.updatedAt > incumbent.updatedAt) owners.set(tabKeyOf(thread), thread);
  }
  const ownedTabs = new Map<string, FloatingTab>();
  const listed: Thread[] = []; const detached: Thread[] = [];
  for (const thread of candidates) {
    const owned = thread.bindingState !== 'attached' && owners.get(tabKeyOf(thread))?.id === thread.id;
    if (owned) ownedTabs.set(thread.id, liveTabs.get(tabKeyOf(thread))!);
    if (thread.bindingState === 'attached' || owned || isLaunchTransitional(thread, now)) listed.push(thread); else detached.push(thread);
  }
  const claimed = new Set([...owners.keys()]);
  return { listed, detached, terminals: unboundTabs.filter((tab) => !claimed.has(sidebarTabKey(tab.machineId, tab.tabId))), ownedTabs };
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
    const demoted = thread.bindingState !== 'attached' || !thread.panes.some((pane) => pane.kind === 'agent');
    if (demoted) {
      const tab = args.floating.find((item) => item.machineId === thread.machineId && item.tabId === thread.tabId);
      if (tab) return { to: 'terminal', session: tab.session, machineId: tab.machineId, tabId: tab.tabId };
    }
  }
  return { to: null };
}
