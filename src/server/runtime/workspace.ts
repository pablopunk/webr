import type { MetadataDatabase } from '../storage/database';
import {
  createOperationEnvelope as createOperationSchema,
  createOperationResult,
  launchOperationState,
  worktreeOperationEnvelope,
  worktreeOperationResult,
} from '../../shared/runtime';

export type CreatedWorkspace = { workspaceId: string; tabId: string; paneId: string; terminalId: string };
type StoredCreateOperation = NonNullable<ReturnType<MetadataDatabase['createOperation']>>;

export function createOperationEnvelope(operation: StoredCreateOperation) {
  const parsedState = launchOperationState.safeParse(operation.state);
  const state = parsedState.success ? parsedState.data : 'unknown';
  const step = typeof operation.step === 'string' && operation.step.length > 0 ? operation.step.slice(0, 64) : 'unknown';
  const error = typeof operation.error === 'string' && operation.error.length > 0 ? operation.error.slice(0, 240) : undefined;
  const statusUrl = `/api/operations/${operation.id}`;
  if (operation.kind === 'worktree') {
    const result = worktreeOperationResult.safeParse(operation.result);
    return worktreeOperationEnvelope.parse({
      operationId: operation.id,
      kind: 'worktree',
      state: state === 'ready' && !result.success ? 'unknown' : state,
      step,
      ...(result.success ? { result: result.data } : {}),
      ...(error ? { error } : {}),
      statusUrl,
    });
  }
  const result = createOperationResult.safeParse(operation.result);
  return createOperationSchema.parse({
    operationId: operation.id,
    kind: operation.kind,
    state,
    step,
    ...(result.success ? { result: result.data } : {}),
    ...(error ? { error } : {}),
    statusUrl,
  });
}
