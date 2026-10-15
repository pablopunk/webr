import { CircleAlert, CircleCheck, Circle, LoaderCircle } from 'lucide-react';
import type { Thread } from '../lib/models';
import { launchFailureMessage, launchStepIndex, launchStepLabel, launchSteps } from '../lib/launch';

export type LaunchProgressOutcome = 'active' | 'failed' | 'unknown';

export function LaunchStepList({ step, worktree, outcome = 'active' }: { step: string; worktree: boolean; outcome?: LaunchProgressOutcome }) {
  const current = launchStepIndex(step);
  return <ol className="launch-steps">
    {launchSteps.map((item, index) => {
      const state = index < current ? 'done' : index === current ? outcome : 'waiting';
      const Icon = state === 'done' ? CircleCheck : state === 'failed' || state === 'unknown' ? CircleAlert : state === 'active' ? LoaderCircle : Circle;
      return <li key={item.id} className={`launch-step is-${state}`} aria-current={state === 'active' ? 'step' : undefined}><Icon size={16} strokeWidth={1.8} aria-hidden="true" />{launchStepLabel(item.id, worktree)}</li>;
    })}
  </ol>;
}

export function LaunchProgress({ thread }: { thread: Thread }) {
  const failed = thread.operation?.state === 'failed';
  const unknown = thread.operation?.state === 'unknown';
  const step = thread.operation?.step ?? 'validate';
  const outcome = unknown ? 'unknown' : failed ? 'failed' : 'active';
  return <main className="launch-progress" aria-label="Launch progress" role="status">
    <h1>{unknown ? 'Launch outcome uncertain' : failed ? 'The launch stopped' : 'Starting your agent'}</h1>
    <blockquote className="launch-prompt">{thread.prompt || thread.title}</blockquote>
    <LaunchStepList step={step} worktree={thread.worktree} outcome={outcome} />
    {(failed || unknown) && <div className="launch-failure" role="alert">
      <p>{unknown ? 'The launch may have reached the machine. Its outcome is uncertain; check the session in Herdr before starting another prompt.' : `Launch stopped while ${launchStepLabel(step, thread.worktree).toLowerCase()}. ${launchFailureMessage(step, thread.worktree)}`}</p>
      {failed && <a className="launch-retry" href={`/new?project=${encodeURIComponent(thread.projectId)}&recover=${encodeURIComponent(thread.id)}`}>Return to your draft</a>}
    </div>}
  </main>;
}
