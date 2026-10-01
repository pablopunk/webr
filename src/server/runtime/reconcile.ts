import { createHash, randomUUID } from 'node:crypto';
import type { MetadataDatabase } from '../storage/database';
import type { NativeSnapshot } from '../protocol/native';
import type { Project, Thread } from '../../lib/models';
import type { TargetAdapter } from './target';

export const projectIdentity = (machineId: string, repository: string) => createHash('sha256').update(machineId + '\0' + repository).digest('hex').slice(0, 32);

export function reconcile(database: MetadataDatabase, target: TargetAdapter, snapshot: NativeSnapshot): { threads: Thread[]; projects: Project[] } {
  const saved = database.threadRows(target.id, target.session);
  const projected: Thread[] = [];
  const projects: Project[] = [];
  for (const workspace of snapshot.workspaces) {
    const cwd = workspace.worktree?.repo_root ?? snapshot.panes.find((pane) => pane.workspace_id === workspace.workspace_id)?.cwd ?? '';
    const projectId = target.locations.find((location) => location.workspaceId === workspace.workspace_id || location.path === cwd)?.projectId ?? projectIdentity(target.id, workspace.worktree?.repo_key ?? (cwd || workspace.workspace_id));
    if (!projects.some((project) => project.id === projectId)) projects.push({ id: projectId, name: workspace.worktree?.repo_name ?? workspace.label, path: cwd, color: '#9b83df', initial: (workspace.label[0] ?? 'P').toUpperCase(), iconUrl: target.icon && target.locations.some((location) => location.projectId === projectId) ? `/api/projects/${encodeURIComponent(target.id)}/${encodeURIComponent(projectId)}/icon` : undefined });
    for (const tab of snapshot.tabs.filter((tab) => tab.workspace_id === workspace.workspace_id)) {
      const panes = snapshot.panes.filter((pane) => pane.tab_id === tab.tab_id && pane.workspace_id === tab.workspace_id);
      const previous = saved.find((row) => row.alias === tab.tab_id);
      if (previous) continue;
      if (database.operations().some((operation) => operation.input.machineId === target.id && ['pending', 'running'].includes(operation.state))) continue;
      if (panes.some((pane) => saved.some((row) => row.anchors.includes(pane.terminal_id)))) continue;
      const thread: Thread = { id: randomUUID(), avatarIndex: database.threadRows().length, projectId, machineId: target.id, title: tab.label ?? 'Terminal', prompt: '', agent: panes.find((pane) => pane.agent)?.agent ?? '', model: '', status: 'unknown', updatedAt: new Date().toISOString(), branch: '', worktree: !!workspace.worktree?.is_linked_worktree, session: target.session, tabId: tab.tab_id, panes: [], bindingState: 'attached' };
      database.saveThread(thread, panes.map((pane) => pane.terminal_id), tab.tab_id);
      saved.push(database.threadRows(target.id, target.session).find((row) => row.id === thread.id)!);
    }
  }
  for (const row of saved) {
    const found = row.anchors.map((id) => snapshot.panes.find((pane) => pane.terminal_id === id)).filter((pane) => !!pane);
    const attached = row.anchors.length > 0 && found.length === row.anchors.length;
    const operation = database.operations().find((operation) => operation.threadId === row.id);
    const thread: Thread = { ...row.metadata, bindingState: attached ? 'attached' : row.anchors.length ? 'detached' : 'pending', status: attached ? found.find((pane) => pane.agent)?.agent_status ?? found[0]?.agent_status ?? 'unknown' : 'unknown', panes: found.map((pane) => ({ id: pane.pane_id, terminalId: pane.terminal_id, title: pane.title ?? pane.terminal_title_stripped ?? pane.agent ?? 'Shell', kind: pane.agent ? 'agent' : 'shell' })), operation: operation ? { id: operation.id, state: operation.state, step: operation.step } : undefined };
    projected.push(thread);
  }
  return { threads: projected, projects };
}
