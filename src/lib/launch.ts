import type { Thread } from './models';

export const launchSteps = [
  { id: 'validate', label: 'Checking the machine', active: 'Checking the machine…' },
  { id: 'checkout', label: 'Creating the worktree', active: 'Creating the worktree…' },
  { id: 'start', label: 'Starting the agent', active: 'Starting the agent…' },
  { id: 'prompt', label: 'Sending your prompt', active: 'Sending your prompt…' },
] as const;
const RECENT_FAILURE_MS = 10 * 60_000;

export const launchStepIndex = (step: string) => step === 'checkout_complete' ? 2 : Math.max(0, launchSteps.findIndex((item) => item.id === step));
export const isLaunching = (thread: Thread) => ['pending', 'running'].includes(thread.operation?.state ?? '') && !thread.panes.some((pane) => pane.kind === 'agent');
export const launchFailed = (thread: Thread) => ['failed', 'unknown'].includes(thread.operation?.state ?? '') && !thread.panes.some((pane) => pane.kind === 'agent');
export const launchLabel = (thread: Thread) => launchSteps[launchStepIndex(thread.operation?.step ?? 'validate')].active;
const failedRecently = (thread: Thread, now: number) => now - Date.parse(thread.updatedAt) < RECENT_FAILURE_MS;
export const isListedThread = (thread: Thread, now = Date.now()) => thread.panes.some((pane) => pane.kind === 'agent') || isLaunching(thread) || launchFailed(thread) && failedRecently(thread, now);
