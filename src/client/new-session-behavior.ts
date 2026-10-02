export type NewSessionBehavior = 'main' | 'worktree' | 'remember';

export const newSessionBehaviorLabels: Record<NewSessionBehavior, string> = {
  main: 'Main checkout',
  worktree: 'New worktree',
  remember: 'Remember by project',
};

const behaviorKey = 'webr-new-session-behavior';
const legacyWorktreeKey = 'webr-new-worktree';
const lastWorktreeKey = (machineId: string, projectId: string) => `webr-last-worktree:${machineId}:${projectId}`;

const isBehavior = (value: string | null): value is NewSessionBehavior => value === 'main' || value === 'worktree' || value === 'remember';
const behaviorFromLegacySetting = (): NewSessionBehavior => (localStorage.getItem(legacyWorktreeKey) === 'false' ? 'main' : 'worktree');

export function readNewSessionBehavior(): NewSessionBehavior {
  const stored = localStorage.getItem(behaviorKey);
  return isBehavior(stored) ? stored : behaviorFromLegacySetting();
}

export function writeNewSessionBehavior(behavior: NewSessionBehavior) {
  localStorage.setItem(behaviorKey, behavior);
}

export function recordWorktreeChoice(machineId: string, projectId: string, worktree: boolean) {
  localStorage.setItem(lastWorktreeKey(machineId, projectId), String(worktree));
}

const rememberedWorktreeChoice = (machineId: string, projectId: string) => localStorage.getItem(lastWorktreeKey(machineId, projectId)) !== 'false';

export function initialWorktreeChoice(machineId: string, projectId: string) {
  const behavior = readNewSessionBehavior();
  return behavior === 'remember' ? rememberedWorktreeChoice(machineId, projectId) : behavior === 'worktree';
}
