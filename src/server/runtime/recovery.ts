import type { ProviderSession, Thread } from '../../lib/models';
import type { NativeSnapshot } from '../protocol/native';

type NativePane = NativeSnapshot['panes'][number];
export function sameSession(a: ProviderSession, b: ProviderSession) {
  return a.agent === b.agent && a.kind === b.kind && a.value === b.value;
}

// Paths come from Herdr on the target host. Never canonicalize an SSH path on the gateway.
function wrongLocation(thread: Thread, pane: NativePane, snapshot: NativeSnapshot) {
  const cwd = pane.foreground_cwd ?? pane.cwd;
  const worktree = snapshot.workspaces.find((workspace) => workspace.workspace_id === pane.workspace_id)?.worktree;
  return !!(thread.expectedCwd && cwd !== thread.expectedCwd ||
    thread.expectedRepository && worktree && worktree.repo_key !== thread.expectedRepository ||
    thread.expectedCheckout && worktree && worktree.checkout_path !== thread.expectedCheckout);
}

function worktreeUnavailable(thread: Thread, pane: NativePane, snapshot: NativeSnapshot) {
  const worktree = snapshot.workspaces.find((workspace) => workspace.workspace_id === pane.workspace_id)?.worktree;
  return !!((thread.expectedRepository || thread.expectedCheckout) && !worktree);
}

export function recoverThread(thread: Thread, anchors: string[], alias: string | null, snapshot: NativeSnapshot, peers: Thread[]): { thread: Thread; tabId: string | null; unsafe: boolean; reservedTabIds?: string[] } {
  const fail = (reason: string, reservedTabIds: string[] = []) => ({ thread: { ...thread, recovery: { state: 'needs_attention' as const, reason } }, tabId: null, unsafe: true, reservedTabIds });
  const sameSessionPanes = thread.providerSession ? snapshot.panes.filter((pane) => pane.agent_session && sameSession(thread.providerSession!, pane.agent_session)) : [];
  const sameOwnerPanes = thread.ownerToken ? snapshot.panes.filter((pane) => pane.tokens?.webr_owner === thread.ownerToken) : [];
  if (thread.providerSession && peers.some((peer) => peer.id !== thread.id && peer.providerSession && sameSession(thread.providerSession!, peer.providerSession))) return fail('conversation_conflict', sameSessionPanes.map((pane) => pane.tab_id));
  if (thread.ownerToken && peers.some((peer) => peer.id !== thread.id && peer.ownerToken === thread.ownerToken)) return fail('owner_conflict', sameOwnerPanes.map((pane) => pane.tab_id));
  const candidates = snapshot.panes.filter((pane) => thread.providerSession && pane.agent_session && sameSession(thread.providerSession, pane.agent_session) || thread.ownerToken && pane.tokens?.webr_owner === thread.ownerToken);
  if (candidates.length > 1) return fail('conversation_conflict', candidates.map((pane) => pane.tab_id));
  const candidate = candidates[0];
  const tabId = candidate?.tab_id ?? alias;
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
  const matchingPanes = snapshot.panes.filter((pane) => pane.agent_session && sameSession(session, pane.agent_session));
  if (matchingPanes.length > 1 || peers.some((peer) => peer.id !== thread.id && peer.providerSession && sameSession(session, peer.providerSession))) return fail('conversation_conflict', matchingPanes.map((pane) => pane.tab_id));
  const worktree = snapshot.workspaces.find((workspace) => workspace.workspace_id === reported.workspace_id)?.worktree;
  const cwd = reported.foreground_cwd ?? reported.cwd;
  if (!cwd) return fail('cwd_missing', [reported.tab_id]);
  if (worktreeUnavailable(thread, reported, snapshot)) return fail('worktree_unverified', [reported.tab_id]);
  if (wrongLocation(thread, reported, snapshot)) return fail('worktree_changed', [reported.tab_id]);
  return {
    thread: { ...thread, providerSession: session, agent: session.agent, expectedCwd: thread.expectedCwd ?? cwd, observedCwd: cwd,
      expectedRepository: thread.expectedRepository ?? worktree?.repo_key, expectedCheckout: thread.expectedCheckout ?? worktree?.checkout_path,
      recovery: { state: restoring ? 'restoring' : reported.agent === session.agent ? 'active' : 'known' } }, tabId, unsafe: false,
  };
}
