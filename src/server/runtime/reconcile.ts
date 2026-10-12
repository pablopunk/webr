import { createHash, randomUUID } from 'node:crypto';
import type { MetadataDatabase } from '../storage/database';
import type { NativeSnapshot } from '../protocol/native';
import type { Project, Thread } from '../../lib/models';
import type { TargetAdapter } from './target';
import { orderPanes } from '../../lib/pane-strip';
import { recoverThread } from './recovery';

export const projectIconKey = (machineId: string, logicalId: string) => `project-icon:${machineId}:${logicalId}`;
const iconRoute = (machineId: string, id: string, version = '') => `/api/projects/${encodeURIComponent(machineId)}/${encodeURIComponent(id)}/icon${version}`;
const customIconVersion = (value?: string) => value ? `?v=${createHash('sha1').update(value).digest('hex').slice(0, 8)}` : undefined;
export const projectNameKey = (machineId: string, logicalId: string) => `project-name:${machineId}:${logicalId}`;
export const projectIdentity = (machineId: string, repository: string) => createHash('sha256').update(machineId + '\0' + repository).digest('hex').slice(0, 32);
const sameBinding = (thread: Thread, target: TargetAdapter) => thread.session === target.session && thread.bindingFingerprint === target.fingerprint && thread.bindingConfigVersion === target.configVersion;
const paneStatus = (panes: NativeSnapshot['panes']) => { const agents = panes.filter((pane) => pane.agent); return ['blocked', 'working', 'done', 'idle', 'unknown'].find((status) => (agents.length ? agents : panes).some((pane) => pane.agent_status === status)) as Thread['status'] | undefined; };
// Sidebar activity means the agent finished something or asked something.
function advancesActivity(before: Thread['status'], after: Thread['status']) {
  if (before === 'unknown' || after === 'unknown') return false; // no signal
  if (after === 'working') return false; // starting work is not an update
  if (before === 'done' && after === 'idle') return false; // read-ack after a visit
  return before !== after;
}
const threadTitle = (label: string | null | undefined, panes: NativeSnapshot['panes'], fallback = 'Terminal') => {
  const namedTab = label?.trim();
  if (namedTab && !/^\d+$/.test(namedTab)) return namedTab;
  const agent = panes.find((pane) => pane.agent && pane.focused) ?? panes.find((pane) => pane.agent);
  return agent?.terminal_title_stripped?.trim() || agent?.title?.trim() || namedTab || fallback;
};

function projectIconUrl(database: MetadataDatabase, target: TargetAdapter, id: string, logicalId: string, located: boolean) {
  const custom = customIconVersion(database.getSetting(projectIconKey(target.id, logicalId)));
  if (custom) return iconRoute(target.id, id, custom);
  return target.icon && located ? iconRoute(target.id, id) : undefined;
}

export function reconcile(database: MetadataDatabase, target: TargetAdapter, snapshot: NativeSnapshot): { threads: Thread[]; projects: Project[] } {
  const saved = database.threadRows(target.id);
  const projects: Project[] = [];
  const tabProjects = new Map<string, string>();
  for (const workspace of snapshot.workspaces) {
    const cwd = workspace.worktree?.repo_root ?? snapshot.panes.find((pane) => pane.workspace_id === workspace.workspace_id)?.cwd ?? '';
    const location = target.locations.find((location) => location.workspaceId === workspace.workspace_id || location.path === cwd);
    const id = location?.projectId ?? projectIdentity(target.id, workspace.worktree?.repo_key ?? (cwd || workspace.workspace_id));
    const logicalId = location?.logicalId ?? workspace.worktree?.repo_key ?? id;
    if (!projects.some((project) => project.id === id)) projects.push({ id, machineId: target.id, localId: location?.localId, logicalId, name: database.getSetting(projectNameKey(target.id, logicalId)) ?? workspace.worktree?.repo_name ?? workspace.label, path: location?.path ?? cwd, color: '#9b83df', initial: (workspace.label[0] ?? 'P').toUpperCase(), iconUrl: projectIconUrl(database, target, id, logicalId, !!location) });
    for (const tab of snapshot.tabs.filter((tab) => tab.workspace_id === workspace.workspace_id)) tabProjects.set(tab.tab_id, id);
  }
  const operations = database.operations();
  const launching = operations.some((operation) => operation.input.machineId === target.id && ['pending', 'running'].includes(operation.state));
  const peers = saved.filter((row) => row.metadata.session === target.session && row.metadata.bindingFingerprint === target.fingerprint).map((row) => row.metadata);
  const recoveries = new Map(saved.map((row) => [row.id, sameBinding(row.metadata, target)
    ? recoverThread(row.metadata, row.anchors, row.alias, snapshot, peers)
    : { thread: { ...row.metadata, recovery: { state: 'needs_attention' as const, reason: 'target_changed' } }, tabId: null, unsafe: true }]));
  // A shell-only projection may appear before Herdr restores the agent. Its layout
  // alias is not conversation ownership; release it once a saved identity proves the match.
  for (const [threadId, binding] of recoveries) {
    if (binding.unsafe || !binding.thread.providerSession || !binding.tabId) continue;
    const layout = saved.find((row) => row.id !== threadId && row.alias === binding.tabId && !row.metadata.agent && !row.metadata.providerSession && !row.metadata.ownerToken && !row.metadata.prompt && !operations.some((operation) => operation.threadId === row.id));
    if (!layout) continue;
    layout.alias = null;
    layout.metadata = { ...layout.metadata, tabId: '', bindingState: 'detached', recovery: { state: 'unbound' } };
    database.saveThread(layout.metadata, layout.anchors, null);
    recoveries.set(layout.id, { thread: layout.metadata, tabId: null, unsafe: false });
  }
  const reservedTabs = new Set([...recoveries.values()].flatMap((binding) => [binding.tabId, ...(binding.reservedTabIds ?? [])]).filter((tabId): tabId is string => !!tabId));
  for (const tab of snapshot.tabs) {
    if (launching || reservedTabs.has(tab.tab_id) || saved.some((row) => row.alias === tab.tab_id)) continue;
    const panes = snapshot.panes.filter((pane) => pane.tab_id === tab.tab_id && pane.workspace_id === tab.workspace_id);
    // Plain shell tabs are terminals, not agent threads. They remain available
    // through the terminal route and are intentionally not persisted as threads.
    if (!panes.length || !panes.some((pane) => pane.agent || pane.agent_session)) continue;
    const thread: Thread = { id: randomUUID(), avatarIndex: database.nextAvatarIndex(), projectId: tabProjects.get(tab.tab_id) ?? '', machineId: target.id, title: threadTitle(tab.label, panes), prompt: '', agent: '', model: '', status: 'unknown', updatedAt: new Date().toISOString(), branch: '', worktree: !!snapshot.workspaces.find((workspace) => workspace.workspace_id === tab.workspace_id)?.worktree?.is_linked_worktree, session: target.session, tabId: tab.tab_id, panes: [], bindingState: 'attached', bindingFingerprint: target.fingerprint, bindingConfigVersion: target.configVersion };
    database.saveThread(thread, panes.map((pane) => pane.terminal_id), tab.tab_id);
    saved.push(database.threadRows(target.id).find((row) => row.id === thread.id)!);
  }
  const threads = saved.map((row): Thread => {
    const recovered = recoveries.get(row.id) ?? recoverThread(row.metadata, row.anchors, row.alias, snapshot, peers);
    const occupied = saved.some((other) => other.id !== row.id && other.alias === recovered.tabId);
    const tab = snapshot.tabs.find((tab) => tab.tab_id === recovered.tabId);
    const members = tab ? snapshot.panes.filter((pane) => pane.tab_id === tab.tab_id && pane.workspace_id === tab.workspace_id) : [];
    const attached = sameBinding(row.metadata, target) && !recovered.unsafe && !occupied && members.length > 0;
    const panes = attached ? members : [];
    const signature = JSON.stringify([panes.map((pane) => [pane.terminal_id, pane.pane_id, pane.agent, pane.agent_status])]);
    const metadata = occupied ? { ...recovered.thread, recovery: { state: 'needs_attention' as const, reason: 'binding_conflict' } } : recovered.thread;
    const operation = operations.find((operation) => operation.threadId === row.id);
    const status: Thread['status'] = attached ? paneStatus(panes) ?? 'unknown' : 'unknown';
    const thread: Thread = { ...metadata, tabId: attached ? tab!.tab_id : metadata.tabId, title: attached ? threadTitle(tab?.label, panes, metadata.title) : metadata.title, projectId: attached ? tabProjects.get(tab!.tab_id) ?? metadata.projectId : metadata.projectId, bindingState: attached ? 'attached' : operation && !row.anchors.length ? 'pending' : 'detached', status, agent: attached ? panes.find((pane) => pane.agent)?.agent ?? metadata.agent : metadata.agent, semanticSignature: attached ? signature : metadata.semanticSignature, updatedAt: advancesActivity(row.metadata.status, status) ? new Date().toISOString() : metadata.updatedAt, panes: orderPanes(panes.map((pane) => ({ id: pane.pane_id, terminalId: pane.terminal_id, title: pane.title ?? pane.terminal_title_stripped ?? pane.agent ?? 'Shell', kind: pane.agent ? 'agent' as const : 'shell' as const })), metadata.paneOrder), operation: operation ? { id: operation.id, state: operation.state, step: operation.step } : undefined };
    const persisted = { ...thread, panes: [], operation: undefined };
    const anchors = attached ? panes.map((pane) => pane.terminal_id) : row.anchors;
    const alias = attached ? tab!.tab_id : row.alias;
    if (JSON.stringify(row.metadata) !== JSON.stringify(persisted) || JSON.stringify(row.anchors) !== JSON.stringify(anchors) || alias !== row.alias) database.saveThread(persisted, anchors, alias);
    return thread;
  });
  return { threads, projects };
}
