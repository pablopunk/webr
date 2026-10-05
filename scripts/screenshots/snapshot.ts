import { nativeSnapshot, type NativeSnapshot } from '../../src/server/protocol/native';
import { demoProjects, demoThreads, shellTerminalIdOf, terminalIdOf, type DemoThread } from './demo';

const AREA = { x: 0, y: 0, width: 80, height: 24 };
const HALF_LEFT = { x: 0, y: 0, width: 40, height: 24 };
const HALF_RIGHT = { x: 40, y: 0, width: 40, height: 24 };
const agentStatus = (thread: DemoThread) => thread.status === 'working' ? 'working' : thread.status === 'blocked' ? 'blocked' : thread.status;

export const projectPath = (root: string, projectId: string) => `${root}/projects/${projectId}`;

function threadEntries(root: string, thread: DemoThread, index: number) {
  const project = demoProjects.find((candidate) => candidate.id === thread.project)!;
  const repoRoot = projectPath(root, project.id);
  const workspace_id = `w${index + 1}`, tab_id = `${workspace_id}:t1`, pane_id = `${workspace_id}:p1`;
  const checkout = thread.linkedWorktree ? `${repoRoot}-${thread.id}` : repoRoot;
  return {
    workspace: { workspace_id, label: project.name, worktree: { repo_key: project.id, repo_name: project.name, repo_root: repoRoot, checkout_path: checkout, is_linked_worktree: thread.linkedWorktree } },
    tab: { tab_id, workspace_id, label: thread.title },
    panes: [
      { pane_id, terminal_id: terminalIdOf(thread), workspace_id, tab_id, focused: index === 0, revision: 1, agent_status: agentStatus(thread), agent: thread.agent, title: thread.title, cwd: checkout },
      ...(thread.shell ? [{ pane_id: `${workspace_id}:p2`, terminal_id: shellTerminalIdOf(thread), workspace_id, tab_id, focused: false, revision: 1, agent_status: 'idle' as const, agent: null, title: 'zsh', cwd: checkout }] : []),
    ],
    layout: { workspace_id, tab_id, area: AREA, panes: thread.shell ? [{ pane_id, rect: HALF_LEFT }, { pane_id: `${workspace_id}:p2`, rect: HALF_RIGHT }] : [{ pane_id, rect: AREA }] },
    agent: { terminal_id: terminalIdOf(thread), state_change_seq: 1 },
  };
}

export function demoSnapshot(root: string): NativeSnapshot {
  const entries = demoThreads.map((thread, index) => threadEntries(root, thread, index));
  return nativeSnapshot.parse({ version: '0.9.3', protocol: 22, workspaces: entries.map((entry) => entry.workspace), tabs: entries.map((entry) => entry.tab), panes: entries.flatMap((entry) => entry.panes), layouts: entries.map((entry) => entry.layout), agents: entries.map((entry) => entry.agent) });
}
