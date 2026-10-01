import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { loadRegistry } from '../src/server/transport/registry';
import { createLiveTransport } from '../src/server/validation/transport';
import { runValidation } from '../src/server/validation/runner';
import { MetadataDatabase } from '../src/server/storage/database';
import { verifyEvidence } from '../src/server/validation/evidence';
import { evidenceKey } from '../src/server/validation/key';

const { values } = parseArgs({ options: { target: { type: 'string' }, consent: { type: 'boolean' }, launch: { type: 'boolean' }, 'launch-only': { type: 'boolean' }, harness: { type: 'string' }, model: { type: 'string' }, project: { type: 'string' }, out: { type: 'string' }, approve: { type: 'boolean' } } });
if (!values.target) throw new Error('Select exactly one approved --target ID (for example --target local)');
const profile = (await loadRegistry(process.env.HERDR_WEB_TARGETS)).find((profile) => profile.id === values.target);
if (!profile) throw new Error('Target is not present in the approved registry');
const launch = values.launch || values['launch-only'] ? z.object({ harness: z.enum(['claude', 'codex', 'opencode']), model: z.string().regex(/^[A-Za-z0-9_/.:+-]{1,120}$/), projectId: z.string().min(1) }).parse({ harness: values.harness, model: values.model, projectId: values.project }) : undefined;
if (!launch && (values.harness || values.model || values.project)) throw new Error('Harness, model and project require explicit --launch consent');
const transport = await createLiveTransport(profile, values.consent === true);
const database = new MetadataDatabase(process.env.HERDR_WEB_DATABASE ?? '.data/gateway.sqlite');
try {
  const key = evidenceKey(database);
  const report = await runValidation(transport, { consent: true, control: !values['launch-only'], launch, outputDirectory: resolve(values.out ?? '.data/validation'), signingKey: key, approve: values.approve });
  console.log(JSON.stringify(report, null, 2));
  if (!report.success || !report.receipt) { process.exitCode = 1; }
  else if (values.approve) {
    const serialized = await readFile(report.receipt, 'utf8');
    if (!verifyEvidence(serialized, key, transport.fingerprint)) throw new Error('Receipt no longer matches the selected target');
    database.setSetting('validation:' + profile.id, serialized); console.log('Approved the automatically measured live receipt for this target');
  }
} finally { await transport.close(); database.close(); }
