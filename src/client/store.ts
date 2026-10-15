import { createStore } from 'zustand/vanilla';
import type { Bootstrap, Projection } from '../shared/runtime';
import type { Project, Thread } from '../lib/models';

type RuntimeState = { projections: Record<string, Projection>; threads: Record<string, Thread>; projects: Record<string, Project>; threadIds: string[]; projectIds: string[]; connected: boolean; install(projection: Projection): boolean; connection(connected: boolean): void };
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const share = <T>(previous: T | undefined, next: T): T => previous && equal(previous, next) ? previous : next;

export function createRuntimeStore(bootstrap: Bootstrap) {
  const retired = new Map<string, Set<string>>();
  const awaiting = new Set<string>();
  const store = createStore<RuntimeState>((set, get) => ({
    projections: {}, threads: {}, projects: {}, threadIds: [], projectIds: [], connected: false,
    connection: (connected) => set((state) => {
      if (connected) return { connected };
      for (const id of Object.keys(state.projections)) awaiting.add(id);
      return { connected, projections: Object.fromEntries(Object.entries(state.projections).map(([id, projection]) => [id, { ...projection, freshAt: null }])), threads: Object.fromEntries(Object.entries(state.threads).map(([id, thread]) => [id, thread.status === 'unknown' ? thread : { ...thread, status: 'unknown' as const }])) };
    }),
    install: (projection) => {
      if (!projection || typeof projection.machineId !== 'string') { console.warn('Dropping projection without machine identity.'); return false; }
      const old = get();
      const previous = old.projections[projection.machineId];
      const generations = retired.get(projection.machineId) ?? new Set<string>();
      if (generations.has(projection.generation) || previous?.generation === projection.generation && (projection.revision < previous.revision || projection.revision === previous.revision && !awaiting.has(projection.machineId))) return false;
      awaiting.delete(projection.machineId);
      if (previous && previous.generation !== projection.generation) generations.add(previous.generation);
      if (generations.size > 8) generations.delete(generations.values().next().value!);
      retired.set(projection.machineId, generations);
      const threads = Object.fromEntries(Object.entries(old.threads).filter(([, thread]) => thread.machineId !== projection.machineId));
      for (const thread of projection.threads ?? []) {
        if (!thread || typeof thread.id !== 'string') { console.warn('Dropping thread without identity.'); continue; }
        const panes = Array.isArray(thread.panes) ? thread.panes : [];
        threads[thread.id] = share(old.threads[thread.id], { ...thread, panes: panes.map((pane) => share(old.threads[thread.id]?.panes.find((oldPane) => oldPane?.id === pane?.id && oldPane?.terminalId === pane?.terminalId), pane)) });
      }
      const rawTabs = projection.availableTabs;
      const droppedTabs = Array.isArray(rawTabs) ? rawTabs.filter((tab) => !tab || typeof tab.tabId !== 'string').length : 0;
      if (droppedTabs > 0) console.warn(`Dropping ${droppedTabs} terminal tab(s) without identity.`);
      const cleanTabs = Array.isArray(rawTabs) ? rawTabs.flatMap((tab) => {
        if (!tab || typeof tab.tabId !== 'string') return [];
        return [{ ...tab, label: tab.label ?? tab.tabId, panes: Array.isArray(tab.panes) ? tab.panes : [] }];
      }) : rawTabs;
      const clean = { ...projection, availableTabs: cleanTabs };
      const projections = { ...old.projections, [projection.machineId]: clean };
      const projects: Record<string, Project> = {};
      for (const entry of Object.values(projections)) for (const project of entry?.projects ?? []) { if (!project || typeof project.id !== 'string') continue; projects[project.id] = share(old.projects[project.id], project); }
      const threadIds = Object.values(threads).sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')).map((thread) => thread.id);
      const projectIds = Object.keys(projects);
      set({ projections, threads, projects, threadIds: share(old.threadIds, threadIds), projectIds: share(old.projectIds, projectIds) });
      return true;
    },
  }));
  for (const projection of bootstrap.projections) store.getState().install(projection);
  return store;
}
export const createUiStore = () => createStore<{ focusedPanes: Record<string, string>; paneWindows: Record<string, number>; focus(scope: string, paneId: string): void; showWindow(scope: string, start: number): void }>((set) => ({
  focusedPanes: {}, paneWindows: {},
  focus: (scope, paneId) => set((state) => ({ focusedPanes: { ...state.focusedPanes, [scope]: paneId } })),
  showWindow: (scope, start) => set((state) => ({ paneWindows: { ...state.paneWindows, [scope]: start } })),
}));
