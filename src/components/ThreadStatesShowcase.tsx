import { Archive, CircleCheck, CircleHelp, MessageCircleQuestion, TriangleAlert } from 'lucide-react';
import { exampleThreads, projects, type Thread } from '../lib/models';
import { ThreadAvatar } from './ThreadAvatar';
import { ProjectIcon } from './ProjectIcon';
import { HarnessIcon } from './HarnessIcon';

const examples = exampleThreads();
const [working, blocked, done, idle] = examples;
const unknown = { ...idle, id: 'unknown', title: 'Unreported status', status: 'unknown' as const };
const launching = {
  ...idle, id: 'launching', title: 'Starting a new agent', status: 'working' as const, panes: [],
  operation: { id: 'launch-demo', state: 'running', step: 'start' },
};
const failed = {
  ...idle, id: 'failed', title: 'Agent could not start', status: 'working' as const, panes: [],
  operation: { id: 'failed-demo', state: 'failed', step: 'start' },
};
const archived = { ...idle, id: 'archived', title: 'Archived thread example', archivedAt: new Date().toISOString() };

const statusInfo: Record<Thread['status'], { label: string; Icon?: typeof CircleHelp }> = {
  working: { label: 'Working' },
  blocked: { label: 'Needs input', Icon: MessageCircleQuestion },
  done: { label: 'Done', Icon: CircleCheck },
  idle: { label: 'Idle' },
  unknown: { label: 'Unknown', Icon: CircleHelp },
};

function DemoRow({ thread, current = false, archivedState = false }: { thread: Thread; current?: boolean; archivedState?: boolean }) {
  const launch = thread.operation?.state === 'running';
  const launchFailed = thread.operation?.state === 'failed';
  const info = statusInfo[thread.status];
  const StatusIcon = launchFailed ? TriangleAlert : launch ? undefined : info.Icon;
  const status = launch ? 'Starting the agent…' : launchFailed ? 'Launch stopped' : info.label;
  const context = launch || launchFailed ? status : 'Claude Code';
  const attention = launchFailed || thread.status === 'blocked' || thread.status === 'done';
  const project = projects.find((item) => item.id === thread.projectId);
  return <div className="thread-item">
    <div className={`thread-row ${thread.status === 'unknown' ? 'status-unknown' : ''} ${current ? 'is-current' : ''} ${attention ? `needs-attention status-${launchFailed ? 'blocked' : thread.status}` : ''}`} aria-current={current ? 'page' : undefined}>
      <span className="thread-avatar" aria-hidden="true">
        {project ? <ProjectIcon project={project} /> : <ThreadAvatar thread={thread} working={thread.status === 'working' || launch} size={24} />}
        {StatusIcon && <StatusIcon className={`thread-status status-${launchFailed ? 'blocked' : thread.status}`} size={14} strokeWidth={2.2} />}
        <span className="thread-avatar-harness"><HarnessIcon harness={thread.agent} size={14} /></span>
      </span>
      <span className="thread-copy">
        <span className="thread-context">{context}</span>
        <span className="thread-name">{thread.title}</span>
      </span>
      <span className="thread-time">{archivedState ? '1d' : '2m'}</span>
    </div>
    <button type="button" className="thread-archive" aria-label="Archive example thread" tabIndex={-1}><Archive size={15} strokeWidth={1.8} aria-hidden="true" /></button>
  </div>;
}

const mainStates: { label: string; thread: Thread; current?: boolean; note: string }[] = [
  { label: 'Current · working', thread: working, current: true, note: 'Selected thread, neutral current indicator, working project icon.' },
  { label: 'Working', thread: { ...working, id: 'working', title: 'Implement the new flow' }, note: 'Agent is actively working.' },
  { label: 'Needs input', thread: blocked, note: 'Blocked state gets a message badge and warm attention surface.' },
  { label: 'Done', thread: done, note: 'Completed state gets a check badge and done-tinted surface.' },
  { label: 'Idle', thread: idle, note: 'No status badge; project icon shown.' },
  { label: 'Unknown', thread: unknown, note: 'Unrecognized or unavailable status.' },
  { label: 'Launching', thread: launching, note: 'Progress replaces the normal project/harness context.' },
  { label: 'Launch stopped', thread: failed, note: 'Failed launch uses a warning badge and attention surface.' },
];

export function ThreadStatesShowcase() {
  return <main className="thread-states-page">
    <header className="thread-states-heading">
      <p className="thread-states-eyebrow">LOCAL UI PREVIEW</p>
      <h1>Thread sidebar states</h1>
      <p>Static, frontend-only examples using the sidebar’s existing row styles. Hover a row to preview its hover treatment.</p>
    </header>
    <div className="thread-states-layout">
      <aside className="sidebar thread-states-sidebar" aria-label="Thread state preview">
        <div className="sidebar-header"><span className="brand"><img src="/brand-mark.png" alt="" width="20" height="20" />webr</span></div>
        <div className="thread-states-section-label">THREADS · STATUS & SELECTION</div>
        <nav className="thread-navigation" aria-label="Example threads">
          {mainStates.map(({ label, thread, current, note }) => <section className="thread-state-example" key={label}>
            <div className="thread-state-caption"><strong>{label}</strong><span>{note}</span></div>
            <DemoRow thread={thread} current={current} />
          </section>)}
        </nav>
        <section className="archived-threads thread-states-archived">
          <div className="group-header"><div className="group-title"><span className="group-chevron">⌄</span><span className="group-name">Archived</span><span className="group-count">1</span></div></div>
          <div className="thread-state-caption"><strong>Archived</strong><span>Shown in its own collapsible group.</span></div>
          <DemoRow thread={archived} archivedState />
        </section>
      </aside>
      <section className="thread-states-notes">
        <h2>What to look for</h2>
        <ul>
          <li><b>Current:</b> raised neutral row with a neutral left marker.</li>
          <li><b>Needs input / Done:</b> status-specific tinted background and badge.</li>
          <li><b>Hover / focus:</b> row surface lifts; archive action appears.</li>
          <li><b>Archived:</b> separated below the active thread list.</li>
        </ul>
        <p>No thread data, navigation, or backend actions are used by this preview.</p>
      </section>
    </div>
  </main>;
}
