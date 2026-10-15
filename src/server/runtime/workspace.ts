import type { MetadataDatabase } from '../storage/database';
import {
  createOperationEnvelope as createOperationSchema,
  createOperationResult,
  launchOperationState,
} from '../../shared/runtime';

export type CreatedWorkspace = { workspaceId: string; tabId: string; paneId: string; terminalId: string };
type StoredCreateOperation = NonNullable<ReturnType<MetadataDatabase['createOperation']>>;

export function createOperationEnvelope(operation: StoredCreateOperation) {
  const state = launchOperationState.safeParse(operation.state).success ? operation.state : 'unknown';
  const result = createOperationResult.safeParse(operation.result);
  const step = typeof operation.step === 'string' && operation.step.length > 0 ? operation.step.slice(0, 64) : 'unknown';
  const error = typeof operation.error === 'string' && operation.error.length > 0 ? operation.error.slice(0, 240) : undefined;
  return createOperationSchema.parse({
    operationId: operation.id,
    kind: operation.kind,
    state,
    step,
    ...(result.success ? { result: result.data } : {}),
    ...(error ? { error } : {}),
    statusUrl: `/api/operations/${operation.id}`,
  });
}
