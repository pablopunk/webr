import { afterEach, expect, it } from 'vitest';
import { MetadataDatabase } from '../src/server/storage/database';
import { reconcile } from '../src/server/runtime/reconcile';
import { FakeTarget } from './fixtures/target';
import type { ProviderSession } from '../src/lib/models';

const databases: MetadataDatabase[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function fixture() {
  const db = new MetadataDatabase(':memory:'); databases.push(db);
  const target = new FakeTarget();
  const session: ProviderSession = { source: 'herdr:omp', agent: 'omp', kind: 'path', value: '/sessions/original.jsonl' };
  Object.assign(target.state.panes[0], { agent: 'omp', agent_session: session, foreground_cwd: '/fixture/subdirectory' });
  const original = reconcile(db, target, target.state).threads[0];
  return { db, target, original, session };
}
it('persists the observed foreground cwd alongside the provider and worktree identity', () => {
  const { db, target, original } = fixture();
  const thread = reconcile(db, target, target.state).threads[0];
  expect(thread).toMatchObject({ id: original.id, expectedCwd: '/fixture/subdirectory', observedCwd: '/fixture/subdirectory', recovery: { state: 'active' } });
  expect(db.threadRows()[0].metadata.observedCwd).toBe('/fixture/subdirectory');
});

it('reattaches the same conversation after tab, pane and terminal IDs change without replaying launch effects', () => {
  const { db, target, original, session } = fixture();
  target.state.tabs[0].tab_id = 'w1:t9';
  Object.assign(target.state.panes[0], { pane_id: 'w1:p9', terminal_id: 'new_terminal', tab_id: 'w1:t9' });
  const threads = reconcile(db, target, target.state).threads;
  expect(threads).toHaveLength(1);
  expect(threads[0]).toMatchObject({ id: original.id, tabId: 'w1:t9', bindingState: 'attached', providerSession: session, recovery: { state: 'active' } });
  expect(db.threadRows()[0].alias).toBe('w1:t9');
  expect(target.effects).toEqual([]);
});

it('retains the conversation reference and agent intent when restore returns a shell, then recognizes the original report', () => {
  const { db, target, original, session } = fixture();
  Object.assign(target.state.panes[0], { agent: null, agent_session: null, restore_error: 'missing_session' });
  expect(reconcile(db, target, target.state).threads[0]).toMatchObject({ id: original.id, agent: 'omp', providerSession: session, recovery: { state: 'needs_attention', reason: 'missing_session' } });
  Object.assign(target.state.panes[0], { agent: 'omp', agent_session: session, restore_error: null });
  expect(reconcile(db, target, target.state).threads[0].recovery).toEqual({ state: 'active' });
});

it.each(['conversation', 'cwd', 'repository', 'checkout', 'owner'] as const)('rejects a restored %s mismatch without overwriting the saved identity', (mismatch) => {
  const { db, target, session } = fixture();
  const pane = target.state.panes[0];
  if (mismatch === 'conversation') pane.agent_session = { ...session, value: '/sessions/replacement.jsonl' };
  if (mismatch === 'cwd') pane.foreground_cwd = '/wrong';
  if (mismatch === 'repository') target.state.workspaces[0].worktree!.repo_key = 'different';
  if (mismatch === 'checkout') target.state.workspaces[0].worktree!.checkout_path = '/different';
  if (mismatch === 'owner') {
    const row = db.threadRows()[0]; db.saveThread({ ...row.metadata, ownerToken: 'original' }, row.anchors, row.alias);
    pane.tokens = { webr_owner: 'different' };
  }
  const thread = reconcile(db, target, target.state).threads[0];
  expect(thread.bindingState).toBe('detached');
  expect(thread.recovery?.state).toBe('needs_attention');
  expect(thread.providerSession).toEqual(session);
  expect(thread.panes).toEqual([]);
});

it('rejects a duplicate live provider reference rather than selecting one pane', () => {
  const { db, target, original } = fixture();
  target.state.tabs.push({ tab_id: 'w1:t2', workspace_id: 'w1', label: 'Duplicate' });
  target.state.panes.push({ ...target.state.panes[0], pane_id: 'w1:p2', tab_id: 'w1:t2', terminal_id: 'duplicate' });
  const thread = reconcile(db, target, target.state).threads.find((thread) => thread.id === original.id)!;
  expect(thread).toMatchObject({ bindingState: 'detached', recovery: { state: 'needs_attention', reason: 'conversation_conflict' } });
  expect(db.threadRows()).toHaveLength(1);
});

it('does not infer a legacy conversation from a reused tab with a new terminal', () => {
  const { db, target } = fixture();
  const row = db.threadRows()[0];
  db.saveThread({ ...row.metadata, providerSession: undefined, expectedCwd: undefined, expectedRepository: undefined, expectedCheckout: undefined }, row.anchors, row.alias);
  target.state.panes[0].terminal_id = 'unknown_occupant';
  const thread = reconcile(db, target, target.state).threads[0];
  expect(thread.providerSession).toBeUndefined();
  expect(thread.recovery).toEqual({ state: 'unbound', reason: 'identity_unverified' });
});

it('refuses to verify a saved repository checkout when Herdr cannot expose its identity', () => {
  const { db, target } = fixture();
  target.state.workspaces[0].worktree = null;
  expect(reconcile(db, target, target.state).threads[0]).toMatchObject({ bindingState: 'detached', recovery: { state: 'needs_attention', reason: 'worktree_unverified' } });
});

it('captures an authoritative report arriving after launch without issuing another start or prompt', () => {
  const db = new MetadataDatabase(':memory:'); databases.push(db); const target = new FakeTarget();
  target.state.panes[0].agent = 'omp';
  const first = reconcile(db, target, target.state).threads[0];
  expect(first.providerSession).toBeUndefined();
  target.state.panes[0].agent_session = { source: 'herdr:omp', agent: 'omp', kind: 'id', value: 'late-session' };
  expect(reconcile(db, target, target.state).threads[0]).toMatchObject({ id: first.id, providerSession: { value: 'late-session' }, recovery: { state: 'active' } });
  expect(target.effects).toEqual([]);
});

it('enforces one durable owner per provider conversation in a target realm', () => {
  const { db, original } = fixture();
  expect(() => db.saveThread({ ...original, id: 'another-thread' }, [], null)).toThrow();
  db.saveThread({ ...original, id: 'another-target', machineId: 'different' }, [], null);
  expect(db.threadRows('different')[0].metadata.providerSession).toEqual(original.providerSession);
});

it('reclaims a layout-only tab adopted while Herdr was still restoring the agent', () => {
  const { db, target, original, session } = fixture();
  target.state.tabs[0].tab_id = 'w1:t9';
  Object.assign(target.state.panes[0], { pane_id: 'w1:p9', terminal_id: 'new_terminal', tab_id: 'w1:t9', agent: null, agent_session: null });
  reconcile(db, target, target.state);
  Object.assign(target.state.panes[0], { agent: 'omp', agent_session: session });
  const threads = reconcile(db, target, target.state).threads;
  expect(threads.find((thread) => thread.id === original.id)).toMatchObject({ tabId: 'w1:t9', bindingState: 'attached', recovery: { state: 'active' } });
  expect(threads.filter((thread) => thread.bindingState === 'attached').map((thread) => thread.id)).toEqual([original.id]);
  expect(target.effects).toEqual([]);
});

it('distinguishes Herdr launch-in-progress from a missing session report', () => {
  const { db, target } = fixture();
  target.state.panes[0].agent_session = null;
  target.state.agents = [{ terminal_id: target.state.panes[0].terminal_id, launch_pending: true }];
  expect(reconcile(db, target, target.state).threads[0].recovery).toEqual({ state: 'restoring' });
  target.state.agents[0].launch_pending = false;
  expect(reconcile(db, target, target.state).threads[0]).toMatchObject({ bindingState: 'detached', recovery: { state: 'needs_attention', reason: 'session_report_missing' } });
});
