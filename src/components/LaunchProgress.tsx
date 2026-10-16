import { useEffect } from 'react';
import { CircleAlert, CircleCheck, Circle, LoaderCircle } from 'lucide-react';
import type { Thread } from '../lib/models';
import { launchFailureMessage, launchStepIndex, launchStepLabel, launchSteps } from '../lib/launch';
import { threadDisplayTitle } from '../client/pending-metadata';
import { LoadingOrbVisual } from './LoadingOrb';
import { useThreadTickets } from '../client/provider';
import { readLaunchDraft, writeLaunchDraft } from '../client/new-thread-draft';

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

export function LaunchLoadingOrb({ step, worktree }: { step: string; worktree: boolean }) {
  const label = launchStepLabel(step, worktree);
  return <div className="loading-orb" role="status" aria-live="polite" aria-busy="true">
    <LoadingOrbVisual />
    <div className="loading-orb-copy">
      <p key={`${step}:${worktree}:${label}`} className="loading-step">{label}…</p>
    </div>
  </div>;
}

export function LaunchProgress({ thread }: { thread: Thread }) {
  const tickets = useThreadTickets();
  const failed = thread.operation?.state === 'failed';
  const unknown = thread.operation?.state === 'unknown';
  const loading = !failed && !unknown;
  const step = thread.operation?.step ?? 'validate';
  const outcome = unknown ? 'unknown' : failed ? 'failed' : 'active';

  useEffect(() => {
    if (!failed) return;
    try {
      if (readLaunchDraft(tickets.recoveryScope, thread.id)) return;
      writeLaunchDraft(tickets.recoveryScope, thread.id, {
        prompt: thread.prompt, images: [], projectId: thread.projectId, machineId: thread.machineId, harness: thread.agent, worktree: thread.worktree,
      });
    } catch { /* Draft recovery is best-effort; the failure copy remains visible. */ }
  }, [failed, thread, tickets]);

  if (loading) {
    return <main className="launch-progress is-loading" aria-label="Launch progress">
      <LaunchLoadingOrb step={step} worktree={thread.worktree} />
    </main>;
  }
  return <main className="launch-progress" aria-label="Launch progress">
    <h1>{unknown ? 'Launch outcome uncertain' : 'The launch stopped'}</h1>
    <blockquote className="launch-prompt">{thread.prompt || threadDisplayTitle(thread)}</blockquote>
    <LaunchStepList step={step} worktree={thread.worktree} outcome={outcome} />
    {(failed || unknown) && <div className="launch-failure" role="alert">
      <p>{unknown ? 'The launch may have reached the machine. Its outcome is uncertain; check the session in Herdr before starting another prompt.' : `Launch stopped while ${launchStepLabel(step, thread.worktree).toLowerCase()}. ${launchFailureMessage(step, thread.worktree)}`}</p>
      {failed && <a className="launch-retry" href={`/new?project=${encodeURIComponent(thread.projectId)}&recover=${encodeURIComponent(thread.id)}`}>Return to your draft</a>}
    </div>}
  </main>;
}
