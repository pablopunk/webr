import { randomBytes } from 'node:crypto';
import type { MetadataDatabase } from '../storage/database';

export function evidenceKey(database: MetadataDatabase, override = process.env.HERDR_WEB_EVIDENCE_KEY) {
  if (override) {
    if (override.length < 32) throw new Error('evidence_key_too_short');
    return override;
  }
  return database.sqlite.transaction(() => {
    const existing = database.getSetting('evidence_key');
    if (existing) return existing;
    const key = randomBytes(32).toString('hex');
    database.setSetting('evidence_key', key);
    return key;
  }).immediate();
}
