import { randomUUID } from 'node:crypto';
import type { MetadataDatabase } from '../storage/database';
import type { TargetAdapter } from './target';

export async function createWorkspace(database: MetadataDatabase, target: TargetAdapter, key: string, path: string, label: string) {
  if (!target.createWorkspace) throw new Error('workspace_creation_unavailable');
  const setting = 'workspace_operation:' + key;
  const input = JSON.stringify({ fingerprint: target.fingerprint, path, label });
  const intent = database.sqlite.transaction(() => {
    const saved = database.getSetting(setting);
    if (saved) {
      const operation = JSON.parse(saved);
      if (operation.input !== input) throw new Error('idempotency_conflict');
      return { ...operation, created: false };
    }
    const operation = { id: randomUUID(), input, state: 'unknown' };
    database.setSetting(setting, JSON.stringify(operation));
    return { ...operation, created: true };
  }).immediate();
  if (!intent.created) return intent.result ?? { operationId: intent.id, state: intent.state };
  const result = await target.createWorkspace(path, label, intent.id);
  database.setSetting(setting, JSON.stringify({ id: intent.id, input, state: 'ready', result }));
  return result;
}
