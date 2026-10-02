import type { MetadataDatabase } from '../storage/database';
import { signEvidence, verifyEvidence } from './evidence';

export function approveMeasuredReceipt(database: MetadataDatabase, targetId: string, fingerprint: string, key: string, serialized: string) {
  const next = verifyEvidence(serialized, key, fingerprint);
  if (!next) throw new Error('Receipt no longer matches the selected target');
  const setting = 'validation:' + targetId;
  const previous = verifyEvidence(database.getSetting(setting), key, fingerprint);
  const matches = (a: (typeof next.grants)[number], b: (typeof next.grants)[number]) => a.kind === b.kind && (a.kind === 'control' || b.kind === 'launch' && a.harness === b.harness && a.projectId === b.projectId && a.model === b.model);
  const grants = [...(previous?.grants.filter((grant) => !next.grants.some((replacement) => matches(grant, replacement))) ?? []), ...next.grants];
  if (grants.length > 32) throw new Error('Too many approved validation grants');
  const evidence = { ...next, grants, expiresAt: previous ? Math.min(previous.expiresAt, next.expiresAt) : next.expiresAt };
  database.setSetting(setting, JSON.stringify(signEvidence(evidence, key)));
  return evidence;
}
