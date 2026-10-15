import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { MetadataDatabase } from '../src/server/storage/database';
import { RuntimeManager } from '../src/server/runtime/manager';
import { createOperationEnvelope } from '../src/server/runtime/workspace';
import { FakeTarget } from './fixtures/target';

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.restoreAllMocks(); });
const worktree = (path = '/fixture') => ({ path, branch: 'feature', label: 'Feature', is_bare: false, is_prunable: false });

function setup(entries: ReturnType<typeof worktree>[], open?: (target: FakeTarget) => Promise<void>) {
  const database = new MetadataDatabase(':memory:'); cleanup.push(() => database.close());
  const target = new FakeTarget();
  const worktrees = vi.fn(async () => entries);
  const openWorktree = vi.fn(async () => { await open?.(target); });
  Object.assign(target, { worktrees, openWorktree });
  const manager = new RuntimeManager(database, [target]); cleanup.push(() => manager.close());
  manager.start();
  return { database, manager, target, worktrees, openWorktree };
}

async function accept(manager: RuntimeManager, target: FakeTarget, path: string) {
  const accepted = manager.acceptCreateOperation('local', 'worktree', randomUUID(), { machineId: target.id, projectId: 'fixture:project', path });
  manager.startCreateOperation(accepted.envelope.operationId);
  return accepted;
}

it('resolves one exact attached thread on a supported read-only target', async () => {
  const { database, manager, target, openWorktree } = setup([worktree()]);
  target.writable = false;
  await expect.poll(() => manager.bootstrap().machines[0]?.connected).toBe(true);
  await expect.poll(() => manager.bootstrap().threads.length).toBe(1);
  const expectedThreadId = manager.bootstrap().threads[0]!.id;
  const accepted = await accept(manager, target, '/fixture');

  await expect.poll(() => database.createOperation(accepted.envelope.operationId)?.state).toBe('ready');
  expect(database.createOperation(accepted.envelope.operationId)).toMatchObject({ state: 'ready', result: { threadId: expectedThreadId } });
  expect(openWorktree).toHaveBeenCalledOnce();
});

it.each([
  { label: 'missing', entries: [], error: 'unknown_worktree' },
  { label: 'ambiguous', entries: [worktree(), worktree()], error: 'ambiguous_worktree' },
])('rejects $label selectable worktree matches before native open', async ({ entries, error }) => {
  const { database, manager, target, openWorktree } = setup(entries);
  target.writable = false;
  await expect.poll(() => manager.bootstrap().machines[0]?.connected).toBe(true);
  const accepted = await accept(manager, target, '/fixture');

  await expect.poll(() => database.createOperation(accepted.envelope.operationId)?.state).toBe('failed');
  expect(database.createOperation(accepted.envelope.operationId)).toMatchObject({ state: 'failed', step: 'validate', error });
  expect(openWorktree).not.toHaveBeenCalled();
});

it.each([
  {
    candidate: 'workspace', error: 'ambiguous_worktree_workspace', mutate: (target: FakeTarget) => target.state.workspaces.push({ ...target.state.workspaces[0]!, workspace_id: 'w2' }),
  },
  {
    candidate: 'tab', error: 'ambiguous_worktree_tab', mutate: (target: FakeTarget) => target.state.tabs.push({ tab_id: 'w1:t2', workspace_id: 'w1', label: 'Duplicate' }),
  },
])('keeps a post-open ambiguous $candidate unknown without guessing or unarchiving', async ({ error, mutate }) => {
  const { database, manager, target, openWorktree } = setup([worktree()], async (target) => { mutate(target); });
  await expect.poll(() => manager.bootstrap().threads.length).toBe(1);
  const thread = manager.bootstrap().threads[0]!;
  manager.archive(target.id, thread.id, true);
  const accepted = await accept(manager, target, '/fixture');

  await expect.poll(() => database.createOperation(accepted.envelope.operationId)?.state).toBe('unknown');
  expect(database.createOperation(accepted.envelope.operationId)).toMatchObject({ state: 'unknown', step: 'open', error, result: {} });
  expect(manager.bootstrap().threads.find((item) => item.id === thread.id)?.archivedAt).toBeTruthy();
  expect(openWorktree).toHaveBeenCalledOnce();
});

it('does not report ready when the unique workspace and tab have no attached thread', async () => {
  const path = '/trees/feature';
  const { database, manager, target, openWorktree } = setup([worktree(path)], async (target) => {
    target.state.workspaces.push({ workspace_id: 'w2', label: 'Feature', worktree: { repo_key: 'fixture', repo_name: 'Fixture', repo_root: '/fixture', checkout_path: path, is_linked_worktree: true } });
    target.state.tabs.push({ tab_id: 'w2:t1', workspace_id: 'w2', label: 'Feature' });
  });
  await expect.poll(() => manager.bootstrap().machines[0]?.connected).toBe(true);
  const accepted = await accept(manager, target, path);

  await expect.poll(() => database.createOperation(accepted.envelope.operationId)?.state).toBe('unknown');
  expect(database.createOperation(accepted.envelope.operationId)).toMatchObject({ state: 'unknown', step: 'open', error: 'worktree_not_opened', result: {} });
  expect(openWorktree).toHaveBeenCalledOnce();
});

it('does not resolve an attached thread from another workspace with a colliding tab ID', async () => {
  const path = '/trees/feature';
  const { database, manager, target, openWorktree } = setup([worktree(path)], async (target) => {
    target.state.workspaces.push({ workspace_id: 'w2', label: 'Feature', worktree: { repo_key: 'fixture', repo_name: 'Fixture', repo_root: '/fixture', checkout_path: path, is_linked_worktree: true } });
    target.state.tabs.unshift({ tab_id: 'w1:t1', workspace_id: 'w2', label: 'Feature' });
    target.state.panes.push({ ...target.state.panes[0]!, pane_id: 'w2:p1', terminal_id: 'term_worktree', workspace_id: 'w2', tab_id: 'w1:t1', agent: null });
    target.state.layouts.push({ workspace_id: 'w2', tab_id: 'w1:t1', area: { x: 0, y: 0, width: 80, height: 24 }, panes: [{ pane_id: 'w2:p1', rect: { x: 0, y: 0, width: 80, height: 24 } }] });
  });
  await expect.poll(() => manager.bootstrap().threads.length).toBe(1);
  const thread = manager.bootstrap().threads[0]!;
  const savedBefore = database.threadRows(target.id).find((row) => row.id === thread.id)!;
  const accepted = await accept(manager, target, path);

  await expect.poll(() => database.createOperation(accepted.envelope.operationId)?.state).toBe('unknown');
  expect(database.createOperation(accepted.envelope.operationId)).toMatchObject({ state: 'unknown', step: 'open', error: 'machine_disconnected', result: {} });
  const savedAfter = database.threadRows(target.id).find((row) => row.id === thread.id)!;
  expect(savedAfter.metadata).toEqual(savedBefore.metadata);
  expect(savedAfter.alias).toBe(savedBefore.alias);
  expect(savedAfter.anchors).toEqual(savedBefore.anchors);
  expect(openWorktree).toHaveBeenCalledOnce();
});

it('keeps a post-open target identity change unknown instead of persisting a stale thread', async () => {
  const { database, manager, target, openWorktree } = setup([worktree()], async (target) => { target.configVersion += 1; });
  await expect.poll(() => manager.bootstrap().threads.length).toBe(1);
  const accepted = await accept(manager, target, '/fixture');

  await expect.poll(() => database.createOperation(accepted.envelope.operationId)?.state).toBe('unknown');
  expect(database.createOperation(accepted.envelope.operationId)).toMatchObject({ state: 'unknown', step: 'open', error: 'machine_disconnected', result: {} });
  expect(openWorktree).toHaveBeenCalledOnce();
});

it('marks a missing post-open observation unknown and never persists a guessed thread', async () => {
  const { database, manager, target, openWorktree } = setup([worktree('/trees/feature')]);
  await expect.poll(() => manager.bootstrap().machines[0]?.connected).toBe(true);
  const accepted = await accept(manager, target, '/trees/feature');

  await expect.poll(() => database.createOperation(accepted.envelope.operationId)?.state).toBe('unknown');
  expect(database.createOperation(accepted.envelope.operationId)).toMatchObject({ state: 'unknown', step: 'open', error: 'worktree_not_opened', result: {} });
  expect(openWorktree).toHaveBeenCalledOnce();
});

it('marks an in-flight worktree open unknown on restart without replaying its native invocation', async () => {
  const database = new MetadataDatabase(':memory:'); cleanup.push(() => database.close());
  const firstTarget = new FakeTarget();
  let release!: () => void; let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const firstOpen = vi.fn(async () => { entered(); await gate; });
  Object.assign(firstTarget, { worktrees: async () => [worktree()], openWorktree: firstOpen });
  const firstManager = new RuntimeManager(database, [firstTarget]);
  firstManager.start();
  await expect.poll(() => firstManager.bootstrap().machines[0]?.connected).toBe(true);
  const accepted = firstManager.acceptCreateOperation('local', 'worktree', randomUUID(), { machineId: firstTarget.id, projectId: 'fixture:project', path: '/fixture' });
  firstManager.startCreateOperation(accepted.envelope.operationId);
  await started;
  expect(database.createOperation(accepted.envelope.operationId)).toMatchObject({ state: 'running', step: 'open' });
  firstManager.supervisors.get(firstTarget.id)!.stop();

  const restartedTarget = new FakeTarget();
  const restartedOpen = vi.fn(async () => {});
  Object.assign(restartedTarget, { worktrees: async () => [worktree()], openWorktree: restartedOpen });
  const restarted = new RuntimeManager(database, [restartedTarget]); cleanup.push(() => restarted.close());
  expect(database.createOperation(accepted.envelope.operationId)).toMatchObject({ state: 'unknown', error: 'create_interrupted' });
  restarted.start();
  await expect.poll(() => restarted.bootstrap().machines[0]?.connected).toBe(true);
  expect(restartedOpen).not.toHaveBeenCalled();

  release();
  await firstManager.close();
  expect(firstOpen).toHaveBeenCalledOnce();
});

it('downgrades malformed persisted ready worktree results to unknown', () => {
  const database = new MetadataDatabase(':memory:');
  try {
    const target = new FakeTarget();
    const created = database.beginCreateOperation('local', 'worktree', randomUUID(), { machineId: target.id, projectId: 'fixture:project', path: '/fixture' }, {
      fingerprint: target.fingerprint, session: target.session, configVersion: target.configVersion,
    }, { state: 'ready', step: 'ready', result: { tabId: 'wrong-shape' } });
    expect(createOperationEnvelope(created.operation)).toMatchObject({ kind: 'worktree', state: 'unknown' });
  } finally { database.close(); }
});
