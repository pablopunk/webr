import type { ProviderSession, Thread } from '../../lib/models';
import type { NativeSnapshot } from '../protocol/native';

type NativePane = NativeSnapshot['panes'][number];
export function sameSession(a: ProviderSession, b: ProviderSession) {
  return a.agent === b.agent && a.kind === b.kind && a.value === b.value;
}

const trimTrailingSeparators = (path: string) => path.replace(/[\\/]+$/, '');
const separatorOf = (path: string) => path.includes('/') ? '/' : '\\';
const isWithin = (root: string, path: string) => { const base = trimTrailingSeparators(root); return path === base || path.startsWith(base + separatorOf(base)); };
const parentOf = (path: string) => { const trimmed = trimTrailingSeparators(path); return trimmed.slice(0, Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))); };
const MIN_SIBLING_PARENT_SEGMENTS = 4;
const isDeepEnoughToShareSiblings = (parent: string) => parent.split(/[\\/]/).filter(Boolean).length >= MIN_SIBLING_PARENT_SEGMENTS;

// Paths come from Herdr on the target host. Never canonicalize an SSH path on the gateway.
export function isSameOrSiblingWorktree(expected: string, cwd: string) {
  const parent = parentOf(expected);
  return isWithin(expected, cwd) || isDeepEnoughToShareSiblings(parent) && cwd !== parent && isWithin(parent, cwd);
}

function wrongLocation(thread: Thread, pane: NativePane, snapshot: NativeSnapshot, sessionProven: boolean) {
  const cwd = pane.foreground_cwd ?? pane.cwd;
  const worktree = snapshot.workspaces.find((workspace) => workspace.workspace_id === pane.workspace_id)?.worktree;
  const cwdMoved = !!thread.expectedCwd && cwd !== thread.expectedCwd;
  const cwdUnacceptable = cwdMoved && !(sessionProven && !!cwd && isSameOrSiblingWorktree(thread.expectedCwd!, cwd));
  return !!(cwdUnacceptable ||
    thread.expectedRepository && worktree && worktree.repo_key !== thread.expectedRepository ||
    thread.expectedCheckout && worktree && worktree.checkout_path !== thread.expectedCheckout);
}

function worktreeUnavailable(thread: Thread, pane: NativePane, snapshot: NativeSnapshot) {
  const worktree = snapshot.workspaces.find((workspace) => workspace.workspace_id === pane.workspace_id)?.worktree;
  return !!((thread.expectedRepository || thread.expectedCheckout) && !worktree);
}

export function recoverThread(thread: Thread, anchors: string[], alias: string | null, snapshot: NativeSnapshot, peers: Thread[]): { thread: Thread; tabId: string | null; unsafe: boolean; reservedTabIds?: string[] } {
  const fail = (reason: string, reservedTabIds: string[] = []) => ({ thread: { ...thread, recovery: { state: 'needs_attention' as const, reason } }, tabId: null, unsafe: true, reservedTabIds });
  const sameOwnerPanes = thread.ownerToken ? snapshot.panes.filter((pane) => pane.tokens?.webr_owner === thread.ownerToken) : [];
  if (thread.ownerToken && peers.some((peer) => peer.id !== thread.id && peer.ownerToken === thread.ownerToken)) return fail('owner_conflict', sameOwnerPanes.map((pane) => pane.tab_id));
  // A surviving anchor in the saved tab proves the existing binding. Provider
  // session IDs are recovery evidence, not unique terminal identities.
  const anchored = alias ? snapshot.panes.filter((pane) => pane.tab_id === alias && anchors.includes(pane.terminal_id)) : [];
  const ownerCandidates = thread.ownerToken ? snapshot.panes.filter((pane) => pane.tokens?.webr_owner === thread.ownerToken) : [];
  const sessionCandidates = thread.providerSession ? snapshot.panes.filter((pane) => pane.agent_session && sameSession(thread.providerSession!, pane.agent_session)) : [];
  const candidates = ownerCandidates.length ? ownerCandidates : sessionCandidates;
  const candidateTabs = [...new Set(candidates.map((pane) => pane.tab_id))];
  if (!anchored.length && candidateTabs.length > 1) return fail(ownerCandidates.length ? 'owner_conflict' : 'conversation_conflict', candidateTabs);
  const candidate = anchored.length
    ? candidates.find((pane) => pane.tab_id === alias) ?? anchored.find((pane) => pane.agent_session || pane.agent) ?? anchored[0]
    : candidateTabs.length === 1
      ? candidates.find((pane) => pane.tab_id === candidateTabs[0])
      : undefined;
  const tabId = anchored.length ? alias : candidate?.tab_id ?? alias;
  const members = snapshot.panes.filter((pane) => pane.tab_id === tabId);
  const reported = candidate ?? members.find((pane) => pane.agent_session) ?? members.find((pane) => pane.agent) ?? members[0];
  if (!reported) return { thread: { ...thread, recovery: { state: thread.providerSession ? 'needs_attention' : 'unbound', reason: thread.providerSession ? 'conversation_missing' : undefined } }, tabId, unsafe: false };
  if (thread.ownerToken && reported.tokens?.webr_owner && reported.tokens.webr_owner !== thread.ownerToken) return fail('owner_conflict', [reported.tab_id]);
  if (thread.providerSession && reported.agent_session && !sameSession(thread.providerSession, reported.agent_session)) return fail('conversation_changed', [reported.tab_id]);
  if (thread.providerSession && reported.agent && reported.agent !== thread.providerSession.agent) return fail('agent_changed', [reported.tab_id]);
  if (reported.restore_error) return { thread: { ...thread, recovery: { state: 'needs_attention', reason: reported.restore_error } }, tabId, unsafe: false };
  const session = reported.agent_session;
  const restoring = snapshot.agents.some((agent) => agent.terminal_id === reported.terminal_id && agent.launch_pending);
  if (!session) return { thread: { ...thread, recovery: { state: thread.providerSession ? restoring ? 'restoring' : 'needs_attention' : 'unbound', reason: thread.providerSession && !restoring ? 'session_report_missing' : undefined } }, tabId, unsafe: !!thread.providerSession && !!reported.agent && !restoring };
  if (reported.agent && reported.agent !== session.agent) return fail('agent_changed', [reported.tab_id]);
  if (!thread.providerSession && !candidate && !anchors.includes(reported.terminal_id)) {
    return { thread: { ...thread, recovery: { state: 'unbound', reason: 'identity_unverified' } }, tabId, unsafe: false };
  }
  const matchingTabs = [...new Set(snapshot.panes.filter((pane) => pane.agent_session && sameSession(session, pane.agent_session)).map((pane) => pane.tab_id))];
  if (!anchored.length && matchingTabs.length > 1 && !ownerCandidates.length) return fail('conversation_conflict', matchingTabs);
  const worktree = snapshot.workspaces.find((workspace) => workspace.workspace_id === reported.workspace_id)?.worktree;
  const cwd = reported.foreground_cwd ?? reported.cwd;
  if (!cwd) return fail('cwd_missing', [reported.tab_id]);
  if (worktreeUnavailable(thread, reported, snapshot)) return fail('worktree_unverified', [reported.tab_id]);
  if (wrongLocation(thread, reported, snapshot, !!thread.providerSession && sameSession(thread.providerSession, session))) return fail('worktree_changed', [reported.tab_id]);
  return {
    thread: { ...thread, providerSession: session, agent: session.agent, expectedCwd: cwd, observedCwd: cwd,
      expectedRepository: thread.expectedRepository ?? worktree?.repo_key, expectedCheckout: thread.expectedCheckout ?? worktree?.checkout_path,
      recovery: { state: restoring ? 'restoring' : reported.agent === session.agent ? 'active' : 'known' } }, tabId, unsafe: false,
  };
}
