import { createHash } from 'node:crypto';
import { localSocket, type TargetProfile } from './registry';
export function targetFingerprint(profile: TargetProfile) {
  return createHash('sha256').update(JSON.stringify({ id: profile.id, transport: profile.transport, host: profile.transport === 'ssh' ? profile.host : 'local', socket: profile.transport === 'ssh' ? profile.socket : localSocket(profile), session: profile.session, executable: profile.executable ?? 'herdr' })).digest('hex');
}
