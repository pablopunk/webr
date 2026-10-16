import { expect, it, vi } from 'vitest';
import { createRuntimeStore, metadataFieldKey, projectStateKey, threadStateKey } from '../src/client/store';
import { threadIsArchived } from '../src/client/pending-metadata';
import type { Projection } from '../src/shared/runtime';

const empty = { projections: [], machines: [], projects: [], threads: [], recoveryScope: 'fixture' };
const projection = (machineId: string, revision: number, threads: Projection['threads'] = [], projects: Projection['projects'] = []): Projection => ({
  machineId, generation: 'generation-1', revision, freshAt: null, connected: true, threads, projects, layouts: [],
});

it('drops identity-less projections instead of throwing', () => {
  const store = createRuntimeStore(empty);
  expect(() => store.getState().install(null as unknown as Projection)).not.toThrow();
  expect(() => store.getState().install({} as unknown as Projection)).not.toThrow();
  expect(store.getState().projections).toEqual({});
});

it('sanitizes poison threads, projects and tabs instead of throwing', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    const store = createRuntimeStore(empty);
    const poison = {
      machineId: 'm', generation: 'g', revision: 1, freshAt: null, connected: true,
      threads: [null, { id: 't1', machineId: 'm', title: 'Hollow', panes: undefined, updatedAt: undefined },
        { id: 't2', machineId: 'm', title: 'Whole', panes: [], updatedAt: '2026-10-14T00:00:00.000Z' }],
      projects: undefined, layouts: [],
      availableTabs: [null, { workspaceId: 'w', bound: false, panes: [] }, { tabId: 'w1:t1', workspaceId: 'w1', bound: false },
        { tabId: 'w1:t2', workspaceId: 'w1', label: 'Term', bound: false, panes: [{ id: 'w1:p', terminalId: 'term', title: 'Shell' }] }],
    } as unknown as Projection;
    expect(() => store.getState().install(poison)).not.toThrow();
    const state = store.getState();
    const t1 = threadStateKey('m', 't1'); const t2 = threadStateKey('m', 't2');
    expect(Object.keys(state.threads).sort()).toEqual([t1, t2].sort());
    expect(state.threads[t1].panes).toEqual([]);
    expect(state.threadIds).toContain(t1);
    expect(state.threadIds).toContain(t2);
    const tabs = state.projections.m.availableTabs ?? [];
    expect(tabs.map((tab) => tab.tabId).sort()).toEqual(['w1:t1', 'w1:t2']);
    expect(tabs.find((tab) => tab.tabId === 'w1:t1')).toMatchObject({ label: 'w1:t1', panes: [] });
    expect(warn).toHaveBeenCalled();
  } finally { warn.mockRestore(); }
});

it('keeps confirmed metadata separate while deriving optimistic title and archive membership', () => {
  const thread = { id: 'same-thread', machineId: 'machine-a', title: 'Native title', titleOverride: undefined, metadataVersion: 3, titleSync: { version: 3, state: 'unknown' as const }, archivedAt: undefined, panes: [], updatedAt: '2026-10-16T00:00:00.000Z' } as unknown as Projection['threads'][number];
  const store = createRuntimeStore(empty);
  store.getState().install(projection('machine-a', 1, [thread]));
  const titleKey = metadataFieldKey('thread', 'machine-a', thread.id, 'titleOverride');
  const archiveKey = metadataFieldKey('thread', 'machine-a', thread.id, 'archived');
  store.getState().setMetadataField(titleKey, { status: 'pending', hasOverlay: true, overlayValue: 'Optimistic title' });
  store.getState().setMetadataField(archiveKey, { status: 'pending', hasOverlay: true, overlayValue: true });
  const state = store.getState();
  const key = threadStateKey('machine-a', thread.id);
  expect(state.confirmedThreads[key].titleOverride).toBeUndefined();
  expect(state.confirmedThreads[key].archivedAt).toBeUndefined();
  expect(state.threads[key]).toMatchObject({ title: 'Native title', titleOverride: 'Optimistic title', archivedAt: undefined });
  expect(threadIsArchived(state.threads[key], state.metadataFields)).toBe(true);
});

it('preserves newer confirmed metadata when a later projection carries older thread and project versions', () => {
  const currentThread = { id: 'thread', avatarIndex: 0, projectId: 'project', machineId: 'machine-a', title: 'Native', titleOverride: 'Current title', prompt: '', agent: '', model: '', status: 'idle', updatedAt: '', branch: '', worktree: false, session: 'session', tabId: 'tab', panes: [], metadataVersion: 5, archivedAt: 'current-archive', titleSync: { version: 5, state: 'pending' } } as Projection['threads'][number];
  const currentProject = { id: 'project', logicalId: 'logical-project', machineId: 'machine-a', name: 'Current project', path: '/project', color: '#000', initial: 'P', metadataVersion: 5 } as Projection['projects'][number];
  const staleThread = { ...currentThread, titleOverride: 'Stale title', archivedAt: 'stale-archive', metadataVersion: 4, titleSync: { version: 4, state: 'failed' as const } };
  const staleProject = { ...currentProject, name: 'Stale project', metadataVersion: 4 };
  const store = createRuntimeStore(empty);
  store.getState().install(projection('machine-a', 1, [currentThread], [currentProject]));
  store.getState().install(projection('machine-a', 2, [staleThread], [staleProject]));
  expect(store.getState().confirmedThreads[threadStateKey('machine-a', 'thread')]).toMatchObject({ titleOverride: 'Current title', archivedAt: 'current-archive', metadataVersion: 5, titleSync: { version: 5, state: 'pending' } });
  expect(store.getState().confirmedProjects[projectStateKey('machine-a', 'logical-project')]).toMatchObject({ name: 'Current project', metadataVersion: 5 });
});

it('keeps thread status unknown across metadata updates until a fresh projection arrives', () => {
  const thread = { id: 'thread', machineId: 'machine-a', title: 'Native', titleOverride: undefined, metadataVersion: 1, titleSync: { version: 1, state: 'unknown' as const }, archivedAt: undefined, panes: [], updatedAt: '', status: 'working' as const } as unknown as Projection['threads'][number];
  const store = createRuntimeStore(empty);
  store.getState().install(projection('machine-a', 1, [thread]));
  store.getState().connection(false);
  const key = threadStateKey('machine-a', thread.id);
  expect(store.getState().threads[key].status).toBe('unknown');
  store.getState().setMetadataField(metadataFieldKey('thread', 'machine-a', thread.id, 'titleOverride'), { status: 'pending', hasOverlay: true, overlayValue: 'Optimistic title' });
  expect(store.getState().threads[key]).toMatchObject({ status: 'unknown', titleOverride: 'Optimistic title' });
  expect(store.getState().confirmedThreads[key].status).toBe('working');
  store.getState().clearMetadataFields();
  expect(store.getState().threads[key].status).toBe('unknown');
  store.getState().install(projection('machine-a', 2, [thread]));
  expect(store.getState().threads[key].status).toBe('working');
});

it('isolates projects with the same logical identity on different machines', () => {
  const store = createRuntimeStore(empty);
  const first = { id: 'project-a', logicalId: 'shared-logical', machineId: 'machine-a', name: 'A', path: '/a', color: '#000', initial: 'A', metadataVersion: 4 };
  const second = { id: 'project-b', logicalId: 'shared-logical', machineId: 'machine-b', name: 'B', path: '/b', color: '#000', initial: 'B', metadataVersion: 7 };
  store.getState().install(projection('machine-a', 1, [], [first]));
  store.getState().install(projection('machine-b', 1, [], [second]));
  const keyA = projectStateKey('machine-a', 'shared-logical'); const keyB = projectStateKey('machine-b', 'shared-logical');
  expect(store.getState().confirmedProjects[keyA].name).toBe('A');
  expect(store.getState().confirmedProjects[keyB].name).toBe('B');
  store.getState().setMetadataField(metadataFieldKey('project', 'machine-a', 'shared-logical', 'name'), { status: 'pending', hasOverlay: true, overlayValue: 'A renamed' });
  expect(store.getState().projects[keyA].name).toBe('A renamed');
  expect(store.getState().projects[keyB].name).toBe('B');
});
