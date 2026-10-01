export type AgentStatus = 'working' | 'blocked' | 'done' | 'idle' | 'unknown';
export const harnessNames: Record<string, string> = {
  claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode', pi: 'Pi',
};

export function harnessName(agent: string): string {
  return Object.hasOwn(harnessNames, agent) ? harnessNames[agent] : agent;
}

export type Project = {
  id: string;
  name: string;
  path: string;
  color: string;
  initial: string;
  iconUrl?: string;
};

export type Pane = {
  id: string;
  title: string;
  kind: 'agent' | 'shell';
  lines: string[];
};

export type Thread = {
  id: string;
  avatarIndex: number;
  projectId: string;
  title: string;
  prompt: string;
  agent: string;
  model: string;
  status: AgentStatus;
  updatedAt: string;
  branch: string;
  worktree: boolean;
  session: string;
  tabId: string;
  panes: Pane[];
  needsAttention?: boolean;
};

export const projects: Project[] = [
  { id: 'herdr', name: 'herdr', path: '~/src/herdr', color: '#9b83df', initial: 'H' },
  { id: 'maze', name: 'maze-monorepo', path: '~/src/maze/monorepo', color: '#e6a76d', initial: 'M' },
  { id: 'spotifin', name: 'spotifin', path: '~/src/spotifin', color: '#70b6a1', initial: 'S' },
];

const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

export function exampleThreads(): Thread[] {
  return [
    {
      id: 'terminal-web-bridge', avatarIndex: 0, projectId: 'herdr', title: 'Build the web terminal bridge',
      prompt: 'Build the web terminal bridge', agent: 'claude', model: 'Default', status: 'working', updatedAt: at(2), branch: 'web-terminal-bridge',
      worktree: true, session: 'default', tabId: 'w1:t2',
      panes: [
        { id: 'w1:p3', title: 'Claude Code', kind: 'agent', lines: [
          '$ claude', '✳ Building the web terminal bridge', '',
          'I found the terminal session control API. Each pane can stream',
          'rendered ANSI frames and accept input, resize, and mouse events.', '',
          '▸ Reading src/client/terminal_sessions.rs', '▸ Checking the frame protocol', '',
          'Working…',
        ] },
        { id: 'w1:p4', title: 'Shell', kind: 'shell', lines: [
          '$ git status --short', ' M src/client/terminal_sessions.rs',
          '$ cargo test terminal_session', '',
          'running 18 tests', 'test terminal::frame_encoding ... ok',
          'test terminal::controller_lifecycle ... ok', '',
          'test result: ok. 18 passed; 0 failed', '$',
        ] },
      ],
    },
    {
      id: 'review-socket-api', avatarIndex: 1, projectId: 'herdr', title: 'Review socket API changes',
      prompt: 'Review socket API changes', agent: 'codex', model: 'Default', status: 'blocked', updatedAt: at(14), branch: 'socket-api-review',
      worktree: true, session: 'default', tabId: 'w1:t3', needsAttention: true,
      panes: [{ id: 'w1:p5', title: 'Codex', kind: 'agent', lines: [
        '$ codex', 'Review complete. One change needs your approval.', '',
        'The new endpoint can replace the active controller.',
        'Allow this change?', '', '> Waiting for input',
      ] }],
    },
    {
      id: 'sidebar-interactions', avatarIndex: 2, projectId: 'herdr', title: 'Polish sidebar interactions',
      prompt: 'Polish sidebar interactions', agent: 'opencode', model: 'Default', status: 'done', updatedAt: at(82), branch: 'sidebar-polish',
      worktree: true, session: 'default', tabId: 'w1:t4', needsAttention: true,
      panes: [{ id: 'w1:p6', title: 'OpenCode', kind: 'agent', lines: [
        '$ opencode', 'Done. The sidebar now keeps its scroll position when',
        'thread status changes. Ready for review.', '', '✓ 12 tests passed', '$',
      ] }],
    },
    {
      id: 'fix-editor-loading', avatarIndex: 3, projectId: 'maze', title: 'Fix editor loading state',
      prompt: 'Fix editor loading state', agent: 'claude', model: 'Default', status: 'working', updatedAt: at(7), branch: 'fix-editor-loading',
      worktree: true, session: 'default', tabId: 'w2:t1',
      panes: [{ id: 'w2:p1', title: 'Claude Code', kind: 'agent', lines: [
        '$ claude', '✳ Investigating the loading state', '',
        'The editor starts a second request while the first one is still',
        'active. I am tracing the state transition now.', '', 'Working…',
      ] }],
    },
    {
      id: 'coverflow-motion', avatarIndex: 4, projectId: 'spotifin', title: 'Tune coverflow motion',
      prompt: 'Tune coverflow motion', agent: 'pi', model: 'Default', status: 'idle', updatedAt: at(1440), branch: 'coverflow-motion',
      worktree: false, session: 'default', tabId: 'w3:t1',
      panes: [{ id: 'w3:p1', title: 'Pi', kind: 'agent', lines: [
        '$ pi', 'The transition timing is now 280ms. All changes are ready',
        'for you to inspect.', '', 'Ready for input',
      ] }],
    },
  ];
}

export function relativeTime(value: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1440)}d`;
}

export function timeAgo(value: string): string {
  const relative = relativeTime(value);
  return relative === 'now' ? 'just now' : `${relative} ago`;
}
