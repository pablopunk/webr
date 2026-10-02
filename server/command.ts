import { spawnSync } from 'node:child_process';

export type CommandResult = { ok: boolean; output: string };
export type RunCommand = (command: string, args: string[], env?: NodeJS.ProcessEnv) => CommandResult;

export const realRun: RunCommand = (command, args, env): CommandResult => {
  const result = spawnSync(command, args, { encoding: 'utf8', env: env ? { ...process.env, ...env } : undefined });
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}${result.error?.message ?? ''}` };
};
