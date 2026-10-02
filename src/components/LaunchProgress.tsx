import { CircleAlert, CircleCheck, Circle, LoaderCircle } from 'lucide-react';
import type { Thread } from '../lib/models';
import { launchFailed, launchStepIndex, launchSteps } from '../lib/launch';

export function LaunchProgress({ thread }: { thread: Thread }) {
  const failed = launchFailed(thread);
  const current = launchStepIndex(thread.operation?.step ?? 'validate');
  return <main className="launch-progress" aria-label="Launch progress" role="status">
    <h1>{failed ? 'The launch stopped' : 'Starting your agent'}</h1>
    <blockquote className="launch-prompt">{thread.prompt || thread.title}</blockquote>
    <ol className="launch-steps">
      {launchSteps.map((step, index) => {
        const state = index < current ? 'done' : index === current ? (failed ? 'failed' : 'active') : 'waiting';
        const Icon = state === 'done' ? CircleCheck : state === 'failed' ? CircleAlert : state === 'active' ? LoaderCircle : Circle;
        return <li key={step.id} className={`launch-step is-${state}`} aria-current={state === 'active' ? 'step' : undefined}><Icon size={16} strokeWidth={1.8} aria-hidden="true" />{step.label}</li>;
      })}
    </ol>
    {failed && <div className="launch-failure" role="alert">
      <p>Herdr stopped while {launchSteps[current].label.toLowerCase()}. The worktree may already exist, so check it in Herdr before you try again.</p>
      <a className="launch-retry" href={`/new?project=${encodeURIComponent(thread.projectId)}`}>Start a new thread</a>
    </div>}
  </main>;
}
