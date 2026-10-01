import type { NativeSnapshot } from '../protocol/native';
import type { LaunchLocation } from '../runtime/target';
import { projectIdentity } from '../runtime/reconcile';
import { scopedProjectId } from '../../shared/projects';

export function nativeLocations(machineId: string, snapshot: NativeSnapshot): LaunchLocation[] {
  const locations = new Map<string, LaunchLocation>();
  for (const workspace of snapshot.workspaces) {
    const path = workspace.worktree?.repo_root ?? snapshot.panes.find((pane) => pane.workspace_id === workspace.workspace_id)?.cwd;
    if (!path?.startsWith('/')) continue;
    const logicalId = workspace.worktree?.repo_key ?? path;
    const localId = projectIdentity(machineId, logicalId);
    const projectId = scopedProjectId(machineId, localId);
    if (!locations.has(projectId) || !workspace.worktree?.is_linked_worktree) locations.set(projectId, { projectId, localId, logicalId, path, workspaceId: workspace.workspace_id });
  }
  return [...locations.values()];
}
