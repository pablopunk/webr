import { createStore } from 'zustand/vanilla';
import type { Bootstrap, Projection } from '../shared/runtime';
import type { Project, Thread } from '../lib/models';

type RuntimeState = { projections: Record<string, Projection>; threads: Record<string, Thread>; projects: Record<string, Project>; threadIds: string[]; projectIds: string[]; connected: boolean; install(projection: Projection): void; connection(connected: boolean): void };
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
      return { connected, projections: Object.fromEntries(Object.entries(state.projections).map(([id, projection]) => [id, { ...projection, connected: false, freshAt: null }])), threads: Object.fromEntries(Object.entries(state.threads).map(([id, thread]) => [id, { ...thread, status: 'unknown' as const, panes: [], bindingState: 'detached' as const }])) };
    }),
    install: (projection) => {
      const old = get();
      const previous = old.projections[projection.machineId];
      const generations = retired.get(projection.machineId) ?? new Set<string>();
      if (generations.has(projection.generation) || !awaiting.has(projection.machineId) && previous?.generation === projection.generation && previous.revision >= projection.revision) return;
      awaiting.delete(projection.machineId);
      if (previous && previous.generation !== projection.generation) generations.add(previous.generation);
      if (generations.size > 8) generations.delete(generations.values().next().value!);
      retired.set(projection.machineId, generations);
      const threads = Object.fromEntries(Object.entries(old.threads).filter(([, thread]) => thread.machineId !== projection.machineId));
      for (const thread of projection.threads) threads[thread.id] = share(old.threads[thread.id], { ...thread, panes: thread.panes.map((pane) => share(old.threads[thread.id]?.panes.find((oldPane) => oldPane.id === pane.id && oldPane.terminalId === pane.terminalId), pane)) });
      const projections = { ...old.projections, [projection.machineId]: projection };
      const projects: Record<string, Project> = {};
      for (const entry of Object.values(projections)) for (const project of entry.projects) projects[project.id] = share(old.projects[project.id], project);
      const threadIds = Object.values(threads).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((thread) => thread.id);
      const projectIds = Object.keys(projects);
      set({ projections, threads, projects, threadIds: share(old.threadIds, threadIds), projectIds: share(old.projectIds, projectIds) });
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
