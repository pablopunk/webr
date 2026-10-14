import type { Thread } from './models';

export const launchSteps = [
  { id: 'validate', label: 'Checking the machine' },
  { id: 'checkout', label: 'Creating the worktree' },
  { id: 'start', label: 'Starting the agent' },
  { id: 'prompt', label: 'Sending your prompt' },
] as const;
const RECENT_FAILURE_MS = 10 * 60_000;

export const launchStepIndex = (step: string) => step === 'checkout_complete' ? 2 : Math.max(0, launchSteps.findIndex((item) => item.id === step));
export const launchStepLabel = (step: string, worktree: boolean) => {
  const current = step === 'checkout_complete' ? 'start' : step;
  return current === 'checkout' && !worktree ? 'Creating the tab' : launchSteps.find((item) => item.id === current)?.label ?? launchSteps[0].label;
};
export const launchActiveLabel = (step: string, worktree: boolean) => `${launchStepLabel(step, worktree)}…`;
export const launchFailureMessage = (step: string, worktree: boolean) => {
  const resource = worktree ? 'worktree' : 'tab';
  if (step === 'validate') return 'The launch could not be validated; nothing was created.';
  if (step === 'checkout' || step === 'checkout_complete') return `The ${resource} may already exist. The agent was not started and your prompt was not sent. Check the session in Herdr before trying again.`;
  if (step === 'start') return `The ${resource} may already exist and the agent may have started. Your prompt was not sent. Check the session in Herdr before trying again.`;
  return `The ${resource} and agent may already exist. Prompt delivery is uncertain; check the session in Herdr before trying again.`;
};
export const isLaunching = (thread: Thread) => ['pending', 'running'].includes(thread.operation?.state ?? '') && !thread.panes.some((pane) => pane.kind === 'agent');
export const launchFailed = (thread: Thread) => ['failed', 'unknown'].includes(thread.operation?.state ?? '') && !thread.panes.some((pane) => pane.kind === 'agent');
export const launchLabel = (thread: Thread) => launchActiveLabel(thread.operation?.step ?? 'validate', thread.worktree);
export const failedRecently = (thread: Thread, now: number) => now - Date.parse(thread.updatedAt) < RECENT_FAILURE_MS;
export const isLaunchTransitional = (thread: Thread, now = Date.now()) => isLaunching(thread) || launchFailed(thread) && failedRecently(thread, now);
export const isListedThread = (thread: Thread, now = Date.now()) => !!thread.agent || !!thread.providerSession || thread.panes.some((pane) => pane.kind === 'agent') || isLaunching(thread) || launchFailed(thread) && failedRecently(thread, now);
