import { randomUUID } from 'node:crypto';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { ValidationJournal } from './journal';
import { Ownership } from './ownership';
import { validateControl } from './control';
import { validateLaunch } from './launch';
import { validateValidatorSchema } from './schema';
import { isLiveTransport } from './transport';
import { signEvidence, controlGranted, launchGranted, controlChecks, launchChecks, type Evidence } from './evidence';
import type { ValidatorTransport, ValidatorOptions, Scratch } from './contracts';

export type ValidationReport = { runId: string; success: boolean; provenance: 'live' | 'fixture'; journal: string; receipt?: string; errors: string[]; recovery: ValidationJournal['recovery']; checks: string[]; grants: Evidence['grants']; missing: string[]; limitations: string[] };
export async function runValidation(transport: ValidatorTransport, options: ValidatorOptions): Promise<ValidationReport> {
  if (!options.consent) throw new Error('Explicit validation consent is required');
  if (!options.control && !options.launch) throw new Error('No validation grant was selected');
  const live = isLiveTransport(transport);
  if (live && (!options.signingKey || options.signingKey.length < 32)) throw new Error('Set a private HERDR_WEB_EVIDENCE_KEY before live validation');
  const inspected = await transport.inspect(); const missing = validateValidatorSchema(inspected.schema);
  if (inspected.version !== 'herdr 0.9.3' || missing.length) throw new Error('Unsupported validator protocol/schema: ' + missing.join('; '));
  const initial = await transport.snapshot();
  if (initial.version !== '0.9.3' || initial.protocol !== 22 || transport.profile.transport === 'local' && !initial.panes.some((pane) => pane.pane_id === transport.callerPaneId)) throw new Error('Selected target/session does not match the caller or supported runtime');
  const runId = randomUUID(); const journal = await ValidationJournal.create(options.outputDirectory, runId); const owner = new Ownership(transport, journal, initial);
  const report: ValidationReport = { runId, success: false, provenance: live ? 'live' : 'fixture', journal: journal.path, errors: [], recovery: journal.recovery, checks: [], grants: [], missing: [...(options.control ? controlChecks.map((check) => 'control/' + check) : []), ...(options.launch ? launchChecks.map((check) => 'launch/' + check) : [])], limitations: ['Literal transport proof does not prove every harness keyboard mode.', 'Only explicitly selected harness and exact model can receive a launch grant.'] };
  let scratch: Scratch | undefined; const grants: Evidence['grants'] = [];
  try {
    const intent = await journal.intent('scratch.create', { targetFingerprint: transport.fingerprint });
    try { scratch = await transport.scratch(runId); await journal.record({ event: 'scratch-created', scratch }); }
    catch (error) { await journal.preserve('Scratch creation outcome unknown', undefined, intent); throw error; }
    if (options.control) { grants.push(await validateControl(owner, scratch)); report.missing = report.missing.filter((check) => !check.startsWith('control/')); }
    if (options.launch) { grants.push(await validateLaunch(owner, scratch, options.launch)); report.missing = report.missing.filter((check) => !check.startsWith('launch/')); }
    const evidence: Evidence = { issuer: 'herdr-web-live-v1', targetFingerprint: transport.fingerprint, version: '0.9.3', protocol: 22, issuedAt: transport.now(), expiresAt: transport.now() + 86400_000, grants };
    if (options.control && !controlGranted(evidence) || options.launch && !grants.some((grant) => grant.kind === 'launch' && launchGranted(evidence, { agent: grant.harness, projectId: grant.projectId, model: grant.model }, grant.locationPath))) throw new Error('Requested grant has incomplete measured checks');
    report.checks = grants.flatMap((grant) => grant.checks); report.grants = grants; report.success = true;
    if (live) {
      const path = join(options.outputDirectory, runId + '.evidence.json'); const file = await open(path, 'wx', 0o600);
      try { await file.write(JSON.stringify(signEvidence(evidence, options.signingKey!))); await file.sync(); } finally { await file.close(); }
      report.receipt = path;
    }
    await journal.record({ event: 'validation-complete', provenance: report.provenance, checks: report.checks, receipt: report.receipt });
  } catch (error) { report.errors.push(error instanceof Error ? error.message : 'Validation failed'); await journal.record({ event: 'validation-failed', errors: report.errors }); }
  finally {
    await owner.cleanup();
    if (scratch && !journal.recovery.length) { try { await transport.removeScratch(scratch); } catch (error) { await journal.preserve('Owned scratch cleanup failed: ' + (error instanceof Error ? error.message : 'unknown')); } }
    if (scratch && journal.recovery.length) await journal.record({ event: 'preserved-scratch', scratch });
    await transport.close(); await journal.close();
  }
  return report;
}
