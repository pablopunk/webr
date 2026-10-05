import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { boundedProcess } from './process';
import { profileSchema, type TargetProfile } from './registry';
import { quoteShell, sshOptions } from './ssh';

const SESSION_LIST_TIMEOUT_MS = 8000;
const savedMachines = z.array(z.object({ id: z.string(), label: z.string(), target: z.string(), session: z.string(), enabled: z.boolean() }));
const sessionsResult = z.object({ sessions: z.array(z.object({ name: z.string(), socket_path: z.string() })) });
const sshMetadata = z.object({ metadata: z.object({ executable: z.string() }) });
const herdrState = (env: NodeJS.ProcessEnv) => join(env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'), 'herdr', 'client');

async function savedExecutable(id: string, env: NodeJS.ProcessEnv) {
  try { return sshMetadata.parse(JSON.parse(await readFile(join(herdrState(env), 'ssh-metadata', id + '.json'), 'utf8'))).metadata.executable; }
  catch { return undefined; }
}

async function remoteSocket(host: string, executable: string, session: string, runProcess: typeof boundedProcess) {
  const command = [executable, 'session', 'list', '--json'].map(quoteShell).join(' ');
  const { sessions } = sessionsResult.parse(JSON.parse(await runProcess('ssh', [...sshOptions, host, command], process.env, SESSION_LIST_TIMEOUT_MS)));
  return sessions.find((candidate) => candidate.name === session)?.socket_path;
}

async function profileOf(machine: z.infer<typeof savedMachines>[number], env: NodeJS.ProcessEnv, runProcess: typeof boundedProcess): Promise<TargetProfile | undefined> {
  const executable = await savedExecutable(machine.id, env);
  if (!executable) return undefined;
  try {
    const socket = await remoteSocket(machine.target, executable, machine.session, runProcess);
    return socket ? profileSchema.parse({ id: machine.id, name: machine.label, session: machine.session, enabled: true, automatic: true, transport: 'ssh', host: machine.target, socket, executable, locations: [] }) : undefined;
  } catch { return undefined; }
}

export async function discoverSavedMachines(env = process.env, runProcess = boundedProcess, onFound: (profile: TargetProfile) => void = () => {}): Promise<TargetProfile[]> {
  try {
    const machines = savedMachines.parse(JSON.parse(await runProcess('herdr', ['machine', 'list', '--json'], env)));
    const profiles = await Promise.all(machines.filter((machine) => machine.enabled).map(async (machine) => { const profile = await profileOf(machine, env, runProcess); if (profile) onFound(profile); return profile; }));
    return profiles.filter((profile): profile is TargetProfile => !!profile);
  } catch { return []; }
}
