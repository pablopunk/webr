import { readFile } from 'node:fs/promises';
import { MetadataDatabase } from '../src/server/storage/database';
import { loadRegistry } from '../src/server/transport/registry';
import { targetFingerprint } from '../src/server/transport/identity';
import { verifyEvidence, controlGranted, launchGranted } from '../src/server/validation/evidence';
import { scopedProjectId } from '../src/shared/projects';

const [id, path] = process.argv.slice(2);
const profile = (await loadRegistry(process.env.HERDR_WEB_TARGETS)).find((profile) => profile.id === id);
if (!profile || !path) throw new Error('Supply an approved target ID and signed live evidence file');
const serialized = await readFile(path, 'utf8');
const evidence = verifyEvidence(serialized, process.env.HERDR_WEB_EVIDENCE_KEY, targetFingerprint(profile));
if (!evidence || !controlGranted(evidence) && !evidence.grants.some((grant) => grant.kind === 'launch' && profile.locations.some((location) => launchGranted(evidence, { agent: grant.harness, model: 'Default', projectId: scopedProjectId(profile.id, location.projectId) }, location.path)))) throw new Error('No complete, valid live evidence matches this target');
const database = new MetadataDatabase(process.env.HERDR_WEB_DATABASE ?? '.data/gateway.sqlite');
try { database.setSetting('validation:' + profile.id, serialized); console.log('Approved matching signed live evidence locally'); } finally { database.close(); }
