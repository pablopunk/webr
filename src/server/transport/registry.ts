import { z } from 'zod';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';

const profile = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/), name: z.string().min(1).max(80), session: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), enabled: z.boolean(),
  transport: z.enum(['local', 'ssh']), host: z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9_.@-]{0,200}$/).optional(),
  socket: z.string().regex(/^\/[A-Za-z0-9_./-]+$/).optional(),
  locations: z.array(z.object({ projectId: z.string().regex(/^[A-Za-z0-9_-]+$/), path: z.string().startsWith('/').max(1000), workspaceId: z.string().min(1).max(160) }).strict()).max(100),
}).strict().superRefine((value, context) => { if (value.transport === 'ssh' && (!value.host || !value.socket)) context.addIssue({ code: 'custom', message: 'SSH requires a host and a verified absolute socket' }); });
export type TargetProfile = z.infer<typeof profile>;
export async function loadRegistry(path?: string): Promise<TargetProfile[]> {
  if (!path) return [];
  const profiles = z.array(profile).max(32).parse(JSON.parse(await readFile(path, 'utf8')));
  if (new Set(profiles.map((profile) => profile.id)).size !== profiles.length) throw new Error('duplicate_target');
  return profiles;
}
export function localSocket(profile: TargetProfile) {
  if (profile.transport !== 'local') throw new Error('not_local');
  if (profile.socket) return profile.socket;
  const config = process.env.HERDR_CONFIG_PATH ? join(process.env.HERDR_CONFIG_PATH, '..') : join(homedir(), '.config/herdr');
  return profile.session === 'default' ? join(config, 'herdr.sock') : join(config, 'sessions', profile.session, 'herdr.sock');
}
