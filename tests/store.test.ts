import { expect, it, vi } from 'vitest';
import { createRuntimeStore } from '../src/client/store';
import type { Projection } from '../src/shared/runtime';

const empty = { projections: [], machines: [], projects: [], threads: [], recoveryScope: 'fixture' };

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
      threads: [
        null,
        { id: 't1', machineId: 'm', title: 'Hollow', panes: undefined, updatedAt: undefined },
        { id: 't2', machineId: 'm', title: 'Whole', panes: [], updatedAt: '2026-10-14T00:00:00.000Z' },
      ],
      projects: undefined,
      layouts: [],
      availableTabs: [
        null,
        { workspaceId: 'w', bound: false, panes: [] },
        { tabId: 'w1:t1', workspaceId: 'w1', bound: false },
        { tabId: 'w1:t2', workspaceId: 'w1', label: 'Term', bound: false, panes: [{ id: 'w1:p', terminalId: 'term', title: 'Shell' }] },
      ],
    } as unknown as Projection;
    expect(() => store.getState().install(poison)).not.toThrow();
    const state = store.getState();
    expect(Object.keys(state.threads).sort()).toEqual(['t1', 't2']);
    expect(state.threads.t1.panes).toEqual([]);
    expect(state.threadIds).toContain('t1');
    expect(state.threadIds).toContain('t2');
    const tabs = state.projections.m.availableTabs ?? [];
    expect(tabs.map((tab) => tab.tabId).sort()).toEqual(['w1:t1', 'w1:t2']);
    expect(tabs.find((tab) => tab.tabId === 'w1:t1')).toMatchObject({ label: 'w1:t1', panes: [] });
    expect(warn).toHaveBeenCalled();
  } finally { warn.mockRestore(); }
});
