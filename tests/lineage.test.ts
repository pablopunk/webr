import { afterEach, expect, it, vi } from 'vitest';
import { MetadataDatabase } from '../src/server/storage/database';
import { reconcile } from '../src/server/runtime/reconcile';
import { RuntimeManager } from '../src/server/runtime/manager';
import { createRuntimeStore } from '../src/client/store';
import { FakeTarget } from './fixtures/target';
import { groupProjectLocations } from '../src/client/project-groups';
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.useRealTimers(); });
function setup() { const db = new MetadataDatabase(':memory:'); cleanups.push(() => db.close()); return { db, target: new FakeTarget() }; }
it('projects native splits and closes using surviving anchors in the same aliased tab', () => {
  const { db, target } = setup(); const initial = reconcile(db, target, target.state).threads[0];
  target.state.panes.push({ ...target.state.panes[0], pane_id: 'w1:p2', terminal_id: 'term_split', focused: false });
  target.state.layouts[0].panes = target.state.panes.map((pane, index) => ({ pane_id: pane.pane_id, rect: { x: index * 40, y: 0, width: 40, height: 24 } }));
  const split = reconcile(db, target, target.state).threads.find((thread) => thread.id === initial.id)!;
  expect(split.panes.map((pane) => pane.terminalId)).toEqual(['term_fixture', 'term_split']); expect(db.threadRows()[0].anchors).toEqual(['term_fixture', 'term_split']);
  target.state.panes.shift(); target.state.layouts[0].panes.shift();
  const closed = reconcile(db, target, target.state).threads[0]; expect(closed.bindingState).toBe('attached'); expect(closed.panes.map((pane) => pane.id)).toEqual(['w1:p2']); expect(db.threadRows()[0].anchors).toEqual(['term_split']);
});
it('removes a moved pane from original tab membership without moving the thread alias', () => {
  const { db, target } = setup(); target.state.panes.push({ ...target.state.panes[0], pane_id: 'w1:p2', terminal_id: 'term_second' });
  const initial = reconcile(db, target, target.state).threads[0];
  target.state.tabs.push({ tab_id: 'w1:t2', workspace_id: 'w1', label: 'Destination' }); target.state.panes[1].tab_id = 'w1:t2';
  const moved = reconcile(db, target, target.state).threads.find((thread) => thread.id === initial.id)!;
  expect(moved.tabId).toBe('w1:t1'); expect(moved.panes.map((pane) => pane.terminalId)).toEqual(['term_fixture']); expect(db.threadRows().find((row) => row.id === initial.id)?.alias).toBe('w1:t1');
  target.state.panes[0].tab_id = 'w1:t2';
  expect(reconcile(db, target, target.state).threads.find((thread) => thread.id === initial.id)?.bindingState).toBe('detached');
});
it('detaches exact reused terminal strings after host or session reconfiguration until explicit adoption', async () => {
  const { db, target } = setup(); const first = new RuntimeManager(db, [target]); first.start(); await expect.poll(() => first.bootstrap().threads.length).toBe(1);
  const id = first.bootstrap().threads[0].id; await first.close();
  const repointed = new FakeTarget(); repointed.sourceIdentity = 'another-host'; repointed.session = 'another-session';
  const second = new RuntimeManager(db, [repointed]); cleanups.push(() => second.close()); second.start();
  await expect.poll(() => second.bootstrap().machines[0].connected).toBe(true);
  const restored = second.bootstrap().threads.find((thread) => thread.id === id)!; expect(restored.bindingState).toBe('detached'); expect(repointed.configVersion).toBe(2);
  expect(() => second.binding(repointed.id, id, 'term_fixture')).toThrow('binding_invalid');
  await second.adopt(repointed.id, id, ['term_fixture']); expect(second.bootstrap().threads.find((thread) => thread.id === id)?.bindingState).toBe('attached'); expect(repointed.effects).toEqual([]);
});
it('scopes same local project IDs on two hosts without losing logical grouping or mixing paths', async () => {
  const { db, target } = setup(); const remote = new FakeTarget(); remote.id = '0123-remote'; remote.projectPath = '/srv/project';
  const manager = new RuntimeManager(db, [target, remote]); cleanups.push(() => manager.close()); manager.start(); await expect.poll(() => manager.bootstrap().projects.length).toBe(2);
  const bootstrap = manager.bootstrap(); const store = createRuntimeStore(bootstrap); const projects = Object.values(store.getState().projects);
  expect(projects.map((project) => project.id)).toEqual(['fixture:project', '0123-remote:project']); expect(projects.map((project) => project.path)).toEqual(['/fixture', '/srv/project']); expect(projects[0].logicalId).toBe(projects[1].logicalId);
  const groups = groupProjectLocations(projects, '0123-remote:project'); expect(groups).toHaveLength(1); expect(groups[0].project.path).toBe('/srv/project'); expect(groups[0].locations).toHaveLength(2);
  expect((await manager.catalog(remote.id, '0123-remote:project')).projectPaths['0123-remote:project']).toBe('/srv/project'); await expect(manager.catalog(remote.id, 'fixture:project')).rejects.toThrow('unknown_project_location');
});
it('publishes meaningful changes once, not busy frame revisions, and advances activity only when an agent finishes or asks', async () => {
  const { db, target } = setup(); const manager = new RuntimeManager(db, [target]); cleanups.push(() => manager.close()); const publish = vi.fn(); manager.on('projection', publish); manager.start();
  await expect.poll(() => target.reads).toBe(2); const before = manager.bootstrap().threads[0].updatedAt; const count = publish.mock.calls.length;
  target.state.panes[0].revision++; target.event!(); await expect.poll(() => target.reads).toBe(3); expect(publish.mock.calls.length).toBe(count);
  target.state.panes[0].title = '⠋ Loading'; target.state.panes[0].terminal_title_stripped = '⠋ Loading'; target.event!();
  await expect.poll(() => manager.bootstrap().threads[0].panes[0]?.title).toBe('⠋ Loading');
  expect(manager.bootstrap().threads[0].updatedAt).toBe(before);
  target.state.panes[0].agent = 'claude'; target.state.panes[0].agent_status = 'working'; target.event!();
  await expect.poll(() => manager.bootstrap().threads[0].status).toBe('working'); expect(manager.bootstrap().threads[0].updatedAt).toBe(before);
  target.state.panes[0].agent_status = 'done'; target.event!();
  await expect.poll(() => manager.bootstrap().threads[0].status).toBe('done');
  const finished = manager.bootstrap().threads[0].updatedAt; expect(finished).not.toBe(before);
  target.state.panes[0].agent_status = 'idle'; target.event!();
  await expect.poll(() => manager.bootstrap().threads[0].status).toBe('idle'); expect(manager.bootstrap().threads[0].updatedAt).toBe(finished);
});
