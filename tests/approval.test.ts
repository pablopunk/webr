import { expect, it } from 'vitest';
import { approveMeasuredReceipt } from '../src/server/validation/approval';
import { controlChecks, launchChecks, signEvidence, verifyEvidence } from '../src/server/validation/evidence';
import type { MetadataDatabase } from '../src/server/storage/database';

const key = 'k'.repeat(64);
const fingerprint = 'local-fixture';
const now = Date.now();
const control = { kind: 'control' as const, inputAdapter: 'literal-pilot-v1' as const, scope: 'literal-transport' as const, checks: [...controlChecks] };
const launch = { kind: 'launch' as const, harness: 'claude' as const, adapter: 'model-argv-v1' as const, projectId: 'local:project', locationPath: '/project', model: 'Default', checks: [...launchChecks] };
const receipt = (grants: (typeof control | typeof launch)[], expiresAt = now + 60_000) => JSON.stringify(signEvidence({ issuer: 'herdr-web-live-v1', targetFingerprint: fingerprint, version: '0.9.3', protocol: 22, issuedAt: now, expiresAt, grants }, key));

it('keeps measured control when a separate launch check is approved', () => {
  let stored = receipt([control], now + 30_000);
  const database = { getSetting: () => stored, setSetting: (_key: string, value: string) => { stored = value; } } as unknown as MetadataDatabase;
  approveMeasuredReceipt(database, 'local', fingerprint, key, receipt([launch]));
  expect(verifyEvidence(stored, key, fingerprint)?.grants).toEqual([control, launch]);
  expect(verifyEvidence(stored, key, fingerprint)?.expiresAt).toBe(now + 30_000);
});
