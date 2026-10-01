import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { LaunchInput } from '../../shared/runtime';

export const controlChecks = ['full-baseline', 'sequence', 'unicode', 'keys', 'paste', 'mouse', 'scroll', 'resize', 'release', 'controller-conflict', 'takeover', 'disconnect', 'no-device-replies'] as const;
export const launchChecks = ['checkout', 'initial-tab', 'start-ready', 'fresh-occupant', 'prompt-once', 'uncertain-effects', 'model-argv'] as const;
const grant = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('control'), inputAdapter: z.literal('literal-pilot-v1'), checks: z.array(z.string()).max(32) }).strict(),
  z.object({ kind: z.literal('launch'), harness: z.enum(['claude', 'codex', 'opencode']), adapter: z.literal('model-argv-v1'), projectId: z.string(), locationPath: z.string(), modelMode: z.enum(['default', 'custom']), checks: z.array(z.string()).max(32) }).strict(),
]);
export const evidenceSchema = z.object({ issuer: z.literal('herdr-web-live-v1'), targetFingerprint: z.string().min(1), version: z.literal('0.9.3'), protocol: z.literal(22), issuedAt: z.number().int().positive(), expiresAt: z.number().int().positive(), grants: z.array(grant).max(32) }).strict();
export type Evidence = z.infer<typeof evidenceSchema>;
export function signEvidence(evidence: Evidence, key: string) { return { evidence, signature: createHmac('sha256', key).update(JSON.stringify(evidenceSchema.parse(evidence))).digest('hex') }; }
export function verifyEvidence(serialized: string | undefined, key: string | undefined, fingerprint: string, now = Date.now()): Evidence | undefined {
  if (!serialized || !key || key.length < 32 || serialized.length > 32 * 1024) return;
  try {
    const envelope = z.object({ evidence: evidenceSchema, signature: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(JSON.parse(serialized));
    const expected = signEvidence(envelope.evidence, key).signature;
    if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(envelope.signature, 'hex'))) return;
    const evidence = envelope.evidence;
    if (evidence.targetFingerprint !== fingerprint || evidence.issuedAt > now || evidence.expiresAt <= now || evidence.expiresAt - evidence.issuedAt > 30 * 86400_000) return;
    return evidence;
  } catch { return; }
}
export function controlGranted(evidence?: Evidence) { return !!evidence?.grants.some((grant) => grant.kind === 'control' && controlChecks.every((check) => grant.checks.includes(check))); }
export function launchGranted(evidence: Evidence | undefined, input: Pick<LaunchInput, 'agent' | 'projectId' | 'model'>, path: string) {
  return !!evidence?.grants.some((grant) => grant.kind === 'launch' && grant.harness === input.agent && grant.projectId === input.projectId && grant.locationPath === path && (input.model === 'Default' || grant.modelMode === 'custom') && launchChecks.every((check) => grant.checks.includes(check)));
}
