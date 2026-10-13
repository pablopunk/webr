import { randomUUID } from 'node:crypto';
import type { MetadataDatabase } from '../storage/database';
import type { TargetAdapter } from './target';

export type CreatedWorkspace = { workspaceId: string; tabId: string; paneId: string; terminalId: string };
const operationPrefix = 'workspace_operation:';
const operationRetentionMs = 30 * 24 * 60 * 60_000;

function pruneWorkspaceOperations(database: MetadataDatabase, now: number) {
  for (const setting of database.settingsWithPrefix(operationPrefix)) {
    try {
      const operation = JSON.parse(setting.value);
      if (operation.state === 'ready' && typeof operation.createdAt === 'number' && operation.createdAt < now - operationRetentionMs) database.deleteSetting(setting.key);
    } catch { /* Preserve malformed records rather than risk replaying an uncertain Herdr request. */ }
  }
}

export async function createWorkspace(database: MetadataDatabase, target: TargetAdapter, key: string, path: string, label: string): Promise<CreatedWorkspace> {
  if (!target.createWorkspace) throw new Error('workspace_creation_unavailable');
  const now = Date.now();
  pruneWorkspaceOperations(database, now);
  const setting = operationPrefix + key;
  const input = JSON.stringify({ fingerprint: target.fingerprint, path, label });
  const intent = database.sqlite.transaction(() => {
    const saved = database.getSetting(setting);
    if (saved) {
      const operation = JSON.parse(saved);
      if (operation.input !== input) throw new Error('idempotency_conflict');
      return operation;
    }
    const operation = { id: randomUUID(), input, state: 'unknown', createdAt: now };
    database.setSetting(setting, JSON.stringify(operation));
    return operation;
  }).immediate();
  if (intent.state === 'ready' && typeof intent.result?.paneId === 'string') return intent.result;
  // Reuse the same Herdr request ID after an uncertain response. Herdr owns
  // the idempotency boundary, so a lost reply can be recovered without
  // creating a second workspace or leaving Webr permanently in "unknown".
  const result = await target.createWorkspace(path, label, intent.id);
  database.setSetting(setting, JSON.stringify({ id: intent.id, input, state: 'ready', createdAt: intent.createdAt ?? now, result }));
  return result;
}
