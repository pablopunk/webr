import { createStore } from 'zustand/vanilla';
import type { Bootstrap, Projection } from '../shared/runtime';
import type { Project, Thread } from '../lib/models';

export type MetadataFieldStatus = 'pending' | 'saved' | 'failed' | 'uncertain' | 'draft';
export type MetadataFieldSnapshot = {
  status: MetadataFieldStatus;
  hasOverlay: boolean;
  overlayValue?: string | null | boolean;
  draftValue?: string | null | boolean;
  message?: string;
  requiresResaveConfirmation?: boolean;
  canonical?: { metadataVersion: number; value: string | null | boolean; archivedAt?: string | null };
};

type RuntimeState = {
  projections: Record<string, Projection>;
  confirmedThreads: Record<string, Thread>;
  confirmedProjects: Record<string, Project>;
  threads: Record<string, Thread>;
  projects: Record<string, Project>;
  metadataFields: Record<string, MetadataFieldSnapshot>;
  threadIds: string[];
  projectIds: string[];
  connected: boolean;
  install(projection: Projection): boolean;
  setMetadataField(key: string, snapshot: MetadataFieldSnapshot | undefined): void;
  clearMetadataFields(): void;
  connection(connected: boolean): void;
};

export const threadStateKey = (machineId: string, threadId: string) => JSON.stringify([machineId, threadId]);
export const projectStateKey = (machineId: string, logicalId: string) => JSON.stringify([machineId, logicalId]);
export const metadataFieldKey = (kind: 'thread' | 'project', machineId: string, entityId: string, field: string) => JSON.stringify([kind, machineId, entityId, field]);
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const share = <T>(previous: T | undefined, next: T): T => previous && equal(previous, next) ? previous : next;

function derivedRecords(confirmedThreads: Record<string, Thread>, confirmedProjects: Record<string, Project>, fields: Record<string, MetadataFieldSnapshot>, oldThreads: Record<string, Thread>, oldProjects: Record<string, Project>, disconnectedMachines: ReadonlySet<string> = new Set()) {
  const threads: Record<string, Thread> = {};
  for (const [key, confirmed] of Object.entries(confirmedThreads)) {
    const titleIntent = fields[metadataFieldKey('thread', confirmed.machineId, confirmed.id, 'titleOverride')];
    const titleOverride = titleIntent?.hasOverlay ? titleIntent.overlayValue as string | null : confirmed.titleOverride ?? null;
    const archiveIntent = fields[metadataFieldKey('thread', confirmed.machineId, confirmed.id, 'archived')];
    const ackIsAhead = archiveIntent?.hasOverlay && archiveIntent.canonical && (confirmed.metadataVersion ?? 0) < archiveIntent.canonical.metadataVersion;
    const archivedAt = ackIsAhead ? archiveIntent.canonical!.archivedAt ?? undefined : confirmed.archivedAt;
    const next = { ...confirmed, titleOverride: titleOverride ?? undefined, archivedAt, status: disconnectedMachines.has(confirmed.machineId) ? 'unknown' as const : confirmed.status };
    threads[key] = share(oldThreads[key], next);
  }
  const projects: Record<string, Project> = {};
  for (const [key, confirmed] of Object.entries(confirmedProjects)) {
    const nameIntent = fields[metadataFieldKey('project', confirmed.machineId ?? 'local', confirmed.logicalId ?? confirmed.id, 'name')];
    const name = nameIntent?.hasOverlay ? nameIntent.overlayValue as string : confirmed.name;
    projects[key] = share(oldProjects[key], { ...confirmed, name });
  }
  return { threads, projects };
}

function versionOf(value: { metadataVersion?: number }) {
  return typeof value.metadataVersion === 'number' && Number.isFinite(value.metadataVersion) ? value.metadataVersion : 0;
}

function preserveNewerThreadMetadata(incoming: Thread, previous: Thread | undefined): Thread {
  const latestTitleSync = previous?.titleSync && previous.titleSync.version > (incoming.titleSync?.version ?? -1)
    ? previous.titleSync
    : incoming.titleSync ?? { version: 0, state: 'unknown' as const };
  if (!previous || versionOf(previous) <= versionOf(incoming)) return { ...incoming, titleSync: latestTitleSync };
  return {
    ...incoming,
    metadataVersion: previous.metadataVersion,
    titleOverride: previous.titleOverride,
    archivedAt: previous.archivedAt,
    titleSync: latestTitleSync,
  };
}

function preserveNewerProjectMetadata(incoming: Project, previous: Project | undefined): Project {
  if (!previous || versionOf(previous) <= versionOf(incoming)) return incoming;
  return { ...incoming, metadataVersion: previous.metadataVersion, name: previous.name };
}

export function createRuntimeStore(bootstrap: Bootstrap) {
  const retired = new Map<string, Set<string>>();
  const awaiting = new Set<string>();
  const disconnectedMachines = new Set<string>();
  const store = createStore<RuntimeState>((set, get) => {
    const projectView = (confirmedProjects: Record<string, Project>, fields: Record<string, MetadataFieldSnapshot>, previous: Record<string, Project>) => derivedRecords({}, confirmedProjects, fields, {}, previous).projects;
    const threadView = (confirmedThreads: Record<string, Thread>, fields: Record<string, MetadataFieldSnapshot>, previous: Record<string, Thread>) => derivedRecords(confirmedThreads, {}, fields, previous, {}, disconnectedMachines).threads;
    const commitProjectionSet = (projections: Record<string, Projection>, prior: RuntimeState, confirmedThreads: Record<string, Thread>, confirmedProjects: Record<string, Project>) => {
      const cleanConfirmedThreads = Object.fromEntries(Object.entries(confirmedThreads).map(([key, thread]) => [key, share(prior.confirmedThreads[key], thread)]));
      const cleanConfirmedProjects = Object.fromEntries(Object.entries(confirmedProjects).map(([key, project]) => [key, share(prior.confirmedProjects[key], project)]));
      const threads = threadView(cleanConfirmedThreads, prior.metadataFields, prior.threads);
      const projects = projectView(cleanConfirmedProjects, prior.metadataFields, prior.projects);
      const threadIds = Object.keys(threads).sort((left, right) => (threads[right].updatedAt ?? '').localeCompare(threads[left].updatedAt ?? ''));
      const projectIds = Object.keys(projects);
      set({ projections, confirmedThreads: cleanConfirmedThreads, confirmedProjects: cleanConfirmedProjects, threads, projects,
        threadIds: share(prior.threadIds, threadIds), projectIds: share(prior.projectIds, projectIds) });
    };
    const ingest = (projection: Projection, oldThreads: Record<string, Thread>, oldProjects: Record<string, Project>) => {
      const confirmedThreads = Object.fromEntries(Object.entries(oldThreads).filter(([, thread]) => thread.machineId !== projection.machineId));
      for (const raw of Array.isArray(projection.threads) ? projection.threads : []) {
        if (!raw || typeof raw.id !== 'string' || !raw.id || raw.machineId !== projection.machineId) {
          console.warn('Dropping thread without matching machine/thread identity.');
          continue;
        }
        const key = threadStateKey(projection.machineId, raw.id);
        const previous = oldThreads[key];
        const panes = Array.isArray(raw.panes) ? raw.panes : [];
        const normalized = { ...raw, panes: panes.map((pane) => share(previous?.panes.find((oldPane) => oldPane?.id === pane?.id && oldPane?.terminalId === pane?.terminalId), pane)) };
        confirmedThreads[key] = share(previous, preserveNewerThreadMetadata(normalized, previous));
      }
      const confirmedProjects = Object.fromEntries(Object.entries(oldProjects).filter(([, project]) => project.machineId !== projection.machineId));
      for (const raw of Array.isArray(projection.projects) ? projection.projects : []) {
        if (!raw || typeof raw.id !== 'string' || !raw.id || raw.machineId !== undefined && raw.machineId !== projection.machineId) {
          console.warn('Dropping project without matching machine/project identity.');
          continue;
        }
        const project = { ...raw, machineId: projection.machineId, logicalId: raw.logicalId ?? raw.id };
        const key = projectStateKey(projection.machineId, project.logicalId!);
        confirmedProjects[key] = share(oldProjects[key], preserveNewerProjectMetadata(project, oldProjects[key]));
      }
      return { confirmedThreads, confirmedProjects };
    };
    const cleanProjection = (projection: Projection): Projection => {
      const rawTabs = projection.availableTabs;
      const droppedTabs = Array.isArray(rawTabs) ? rawTabs.filter((tab) => !tab || typeof tab.tabId !== 'string').length : 0;
      if (droppedTabs > 0) console.warn(`Dropping ${droppedTabs} terminal tab(s) without identity.`);
      const availableTabs = Array.isArray(rawTabs) ? rawTabs.flatMap((tab) => {
        if (!tab || typeof tab.tabId !== 'string') return [];
        return [{ ...tab, label: tab.label ?? tab.tabId, panes: Array.isArray(tab.panes) ? tab.panes : [] }];
      }) : rawTabs;
      return { ...projection, availableTabs };
    };
    const initial: RuntimeState = {
      projections: {}, confirmedThreads: {}, confirmedProjects: {}, threads: {}, projects: {}, metadataFields: {},
      threadIds: [], projectIds: [], connected: false,
      connection: (connected) => set((state) => {
        if (connected) return { connected };
        for (const id of Object.keys(state.projections)) { awaiting.add(id); disconnectedMachines.add(id); }
        return { connected, projections: Object.fromEntries(Object.entries(state.projections).map(([id, projection]) => [id, { ...projection, freshAt: null }])), threads: Object.fromEntries(Object.entries(state.threads).map(([id, thread]) => [id, thread.status === 'unknown' ? thread : { ...thread, status: 'unknown' as const }])) };
      }),
      install: (projection) => {
        if (!projection || typeof projection.machineId !== 'string' || !projection.machineId) { console.warn('Dropping projection without machine identity.'); return false; }
        const old = get();
        const previous = old.projections[projection.machineId];
        const generations = retired.get(projection.machineId) ?? new Set<string>();
        if (generations.has(projection.generation) || previous?.generation === projection.generation && (projection.revision < previous.revision || projection.revision === previous.revision && !awaiting.has(projection.machineId))) return false;
        awaiting.delete(projection.machineId);
        disconnectedMachines.delete(projection.machineId);
        if (previous && previous.generation !== projection.generation) generations.add(previous.generation);
        if (generations.size > 8) generations.delete(generations.values().next().value!);
        retired.set(projection.machineId, generations);
        const { confirmedThreads, confirmedProjects } = ingest(projection, old.confirmedThreads, old.confirmedProjects);
        const rawProjection = cleanProjection(projection);
        commitProjectionSet({ ...old.projections, [projection.machineId]: rawProjection }, old, confirmedThreads, confirmedProjects);
        return true;
      },
      setMetadataField: (key, snapshot) => set((state) => {
        const metadataFields = { ...state.metadataFields };
        if (snapshot) metadataFields[key] = snapshot;
        else delete metadataFields[key];
        const { threads, projects } = derivedRecords(state.confirmedThreads, state.confirmedProjects, metadataFields, state.threads, state.projects, disconnectedMachines);
        return { metadataFields, threads, projects };
      }),
      clearMetadataFields: () => set((state) => {
        const metadataFields: Record<string, MetadataFieldSnapshot> = {};
        const { threads, projects } = derivedRecords(state.confirmedThreads, state.confirmedProjects, metadataFields, state.threads, state.projects, disconnectedMachines);
        return { metadataFields, threads, projects };
      }),
    };
    return initial;
  });
  for (const projection of bootstrap.projections) store.getState().install(projection);
  for (const projection of bootstrap.projections) awaiting.add(projection.machineId);
  return store;
}

export const createUiStore = () => createStore<{ focusedPanes: Record<string, string>; paneWindows: Record<string, number>; focus(scope: string, paneId: string): void; showWindow(scope: string, start: number): void }>((set) => ({
  focusedPanes: {}, paneWindows: {},
  focus: (scope, paneId) => set((state) => ({ focusedPanes: { ...state.focusedPanes, [scope]: paneId } })),
  showWindow: (scope, start) => set((state) => ({ paneWindows: { ...state.paneWindows, [scope]: start } })),
}));
