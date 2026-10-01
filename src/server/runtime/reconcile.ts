import { createHash, randomUUID } from 'node:crypto';
import type { MetadataDatabase } from '../storage/database';
import type { NativeSnapshot } from '../protocol/native';
import type { Project, Thread } from '../../lib/models';
import type { TargetAdapter } from './target';

export const projectIdentity = (machineId: string, repository: string) => createHash('sha256').update(machineId + '\0' + repository).digest('hex').slice(0, 32);
const sameBinding = (thread: Thread, target: TargetAdapter) => thread.session === target.session && thread.bindingFingerprint === target.fingerprint && thread.bindingConfigVersion === target.configVersion;
const paneStatus = (panes: NativeSnapshot['panes']) => { const agents = panes.filter((pane) => pane.agent); return ['blocked', 'working', 'done', 'idle', 'unknown'].find((status) => (agents.length ? agents : panes).some((pane) => pane.agent_status === status)) as Thread['status'] | undefined; };

export function reconcile(database: MetadataDatabase, target: TargetAdapter, snapshot: NativeSnapshot): { threads: Thread[]; projects: Project[] } {
  const saved = database.threadRows(target.id);
  const projects: Project[] = [];
  const tabProjects = new Map<string, string>();
  for (const workspace of snapshot.workspaces) {
    const cwd = workspace.worktree?.repo_root ?? snapshot.panes.find((pane) => pane.workspace_id === workspace.workspace_id)?.cwd ?? '';
    const location = target.locations.find((location) => location.workspaceId === workspace.workspace_id || location.path === cwd);
    const id = location?.projectId ?? projectIdentity(target.id, workspace.worktree?.repo_key ?? (cwd || workspace.workspace_id));
    if (!projects.some((project) => project.id === id)) projects.push({ id, machineId: target.id, localId: location?.localId, logicalId: location?.logicalId ?? workspace.worktree?.repo_key ?? id, name: workspace.worktree?.repo_name ?? workspace.label, path: location?.path ?? cwd, color: '#9b83df', initial: (workspace.label[0] ?? 'P').toUpperCase(), iconUrl: target.icon && location ? `/api/projects/${encodeURIComponent(target.id)}/${encodeURIComponent(id)}/icon` : undefined });
    for (const tab of snapshot.tabs.filter((tab) => tab.workspace_id === workspace.workspace_id)) tabProjects.set(tab.tab_id, id);
  }
  const launching = database.operations().some((operation) => operation.input.machineId === target.id && ['pending', 'running'].includes(operation.state));
  for (const tab of snapshot.tabs) {
    if (launching || saved.some((row) => row.alias === tab.tab_id)) continue;
    const panes = snapshot.panes.filter((pane) => pane.tab_id === tab.tab_id && pane.workspace_id === tab.workspace_id);
    if (!panes.length) continue;
    const thread: Thread = { id: randomUUID(), avatarIndex: database.threadRows().length, projectId: tabProjects.get(tab.tab_id) ?? '', machineId: target.id, title: tab.label ?? 'Terminal', prompt: '', agent: '', model: '', status: 'unknown', updatedAt: new Date().toISOString(), branch: '', worktree: !!snapshot.workspaces.find((workspace) => workspace.workspace_id === tab.workspace_id)?.worktree?.is_linked_worktree, session: target.session, tabId: tab.tab_id, panes: [], bindingState: 'attached', bindingFingerprint: target.fingerprint, bindingConfigVersion: target.configVersion };
    database.saveThread(thread, panes.map((pane) => pane.terminal_id), tab.tab_id);
    saved.push(database.threadRows(target.id).find((row) => row.id === thread.id)!);
  }
  const operations = database.operations();
  const threads = saved.map((row): Thread => {
    const tab = snapshot.tabs.find((tab) => tab.tab_id === row.alias);
    const members = tab ? snapshot.panes.filter((pane) => pane.tab_id === tab.tab_id && pane.workspace_id === tab.workspace_id) : [];
    const attached = sameBinding(row.metadata, target) && members.some((pane) => row.anchors.includes(pane.terminal_id));
    const panes = attached ? members : [];
    const signature = JSON.stringify([tab?.label, panes.map((pane) => [pane.terminal_id, pane.pane_id, pane.agent, pane.agent_status, pane.title, snapshot.agents.find((agent) => agent.terminal_id === pane.terminal_id)?.state_change_seq])]);
    const meaningfulChange = attached && row.metadata.semanticSignature !== signature;
    const operation = operations.find((operation) => operation.threadId === row.id);
    const thread: Thread = { ...row.metadata, title: attached && !row.metadata.prompt ? tab?.label ?? row.metadata.title : row.metadata.title, projectId: attached ? tabProjects.get(tab!.tab_id) ?? row.metadata.projectId : row.metadata.projectId, bindingState: attached ? 'attached' : operation && !row.anchors.length ? 'pending' : 'detached', status: attached ? paneStatus(panes) ?? 'unknown' : 'unknown', agent: attached ? panes.find((pane) => pane.agent)?.agent ?? '' : row.metadata.agent, semanticSignature: attached ? signature : row.metadata.semanticSignature, updatedAt: meaningfulChange ? new Date().toISOString() : row.metadata.updatedAt, panes: panes.map((pane) => ({ id: pane.pane_id, terminalId: pane.terminal_id, title: pane.title ?? pane.terminal_title_stripped ?? pane.agent ?? 'Shell', kind: pane.agent ? 'agent' : 'shell' })), operation: operation ? { id: operation.id, state: operation.state, step: operation.step } : undefined };
    if (attached && (meaningfulChange || JSON.stringify(row.anchors) !== JSON.stringify(panes.map((pane) => pane.terminal_id)))) database.saveThread({ ...thread, panes: [], operation: undefined }, panes.map((pane) => pane.terminal_id), row.alias);
    return thread;
  });
  return { threads, projects };
}
