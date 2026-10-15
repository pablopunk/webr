import { z } from 'zod';
import type { Project, Thread } from '../lib/models';
import type { Machine } from '../lib/machines';

export const opaqueId = z.string().min(1).max(160).regex(/^[A-Za-z0-9_:.-]+$/);
export const launchInput = z.object({
  machineId: opaqueId, projectId: opaqueId,
  prompt: z.string().trim().min(1).max(8000).refine((text) => !/[\x00\x1b]/.test(text)),
  agent: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
  model: z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9_/.:+-]+$/),
  worktree: z.boolean(),
}).strict();
export type LaunchInput = z.infer<typeof launchInput>;
const createPath = z.string().regex(/^(\/|~\/)/).max(1000).refine((path) => !/[\x00-\x1f]/.test(path));
export const workspaceCreateInput = z.object({ machineId: opaqueId, path: createPath, label: z.string().trim().min(1).max(80) }).strict();
export const terminalCreateInput = z.object({ machineId: opaqueId, path: createPath }).strict();
export const worktreeOpenInput = z.object({ machineId: opaqueId, projectId: opaqueId, path: z.string().min(1).max(1000).refine((path) => !/[\x00-\x1f]/.test(path)) }).strict();
export type WorkspaceCreateInput = z.infer<typeof workspaceCreateInput>;
export type TerminalCreateInput = z.infer<typeof terminalCreateInput>;
export type WorktreeOpenInput = z.infer<typeof worktreeOpenInput>;
export type CreateOperationKind = 'workspace' | 'terminal' | 'worktree';
export type CreateOperationInput = WorkspaceCreateInput | TerminalCreateInput | WorktreeOpenInput;
export function parseCreateOperationInput(kind: string, input: unknown): CreateOperationInput {
  if (kind === 'workspace') return workspaceCreateInput.parse(input);
  if (kind === 'terminal') return terminalCreateInput.parse(input);
  if (kind === 'worktree') return worktreeOpenInput.parse(input);
  throw new Error('invalid_create_operation_kind');
}
export const launchOperationState = z.enum(['pending', 'running', 'ready', 'failed', 'unknown']);
export const createOperationResult = z.object({ workspaceId: z.string().min(1).max(160), tabId: z.string().min(1).max(160), paneId: z.string().min(1).max(160), terminalId: z.string().min(1).max(160) }).strict();
export const worktreeOperationResult = z.object({ threadId: z.string().min(1).max(160) }).strict();
export const createOperationEnvelope = z.object({
  operationId: z.uuid(), kind: z.enum(['workspace', 'terminal']), state: launchOperationState, step: z.string().min(1).max(64),
  result: createOperationResult.optional(), error: z.string().min(1).max(240).optional(), statusUrl: z.string().min(1).max(200),
}).strict();
export const worktreeOperationEnvelope = z.object({
  operationId: z.uuid(), kind: z.literal('worktree'), state: launchOperationState, step: z.string().min(1).max(64),
  result: worktreeOperationResult.optional(), error: z.string().min(1).max(240).optional(), statusUrl: z.string().min(1).max(200),
}).strict().superRefine((envelope, context) => {
  if (envelope.state === 'ready' && !envelope.result) context.addIssue({ code: 'custom', path: ['result'], message: 'ready worktree operation requires a thread identity' });
});
export type CreateOperationEnvelope = z.infer<typeof createOperationEnvelope>;
export type WorktreeOperationEnvelope = z.infer<typeof worktreeOperationEnvelope>;
export const launchOperationEnvelope = z.object({
  operationId: z.uuid(), kind: z.literal('thread'), state: launchOperationState, step: z.string().min(1).max(64),
  result: z.object({ threadId: z.string().min(1).max(160) }).strict().optional(), error: z.string().min(1).max(240).optional(),
  statusUrl: z.string().min(1).max(200),
}).strict();
export type LaunchOperationEnvelope = z.infer<typeof launchOperationEnvelope>;
export type LaunchAcceptance = LaunchOperationEnvelope & { id: string };
export type LaunchOperationStatus = LaunchOperationEnvelope & { id: string; threadId: string };
/** Task 012 boundary: retire an acknowledged overlay only when the base version is at least its acknowledged version. At the exact version, editable fields match this response; later versions may supersede them. Unrelated version advancement without an acknowledgement proves nothing. */
export type ThreadMetadataAcknowledgement = {
  entityId: string;
  metadataVersion: number;
  metadata: { titleOverride: string | null; archivedAt: string | null };
};
export type ThreadRenameResponse = ThreadMetadataAcknowledgement & { title: string };
export type ThreadArchiveResponse = ThreadMetadataAcknowledgement & { archived: boolean };
export type ProjectMetadataAcknowledgement = {
  machineId: string;
  entityId: string;
  metadataVersion: number;
  metadata: { name: string };
};
export type ProjectRenameResponse = ProjectMetadataAcknowledgement & { name: string };
export type Rect = { x: number; y: number; width: number; height: number };
export type Layout = { workspaceId: string; tabId: string; area: Rect; panes: { paneId: string; rect: Rect }[] };
export type Projection = {
  machineId: string; generation: string; revision: number; freshAt: string | null;
  connected: boolean; error?: string; threads: Thread[]; projects: Project[]; layouts: Layout[];
  availableTabs?: { tabId: string; workspaceId: string; label: string; bound: boolean; panes: { id: string; terminalId: string; title: string }[] }[];
  machine?: Machine;
};
export type Bootstrap = { projections: Projection[]; machines: Machine[]; projects: Project[]; threads: Thread[]; recoveryScope: string; resourceRecoveryScope?: string };
const streamRef = { streamId: z.number().int().min(1).max(0xffffffff), generation: z.number().int().min(1).max(0xffffffff) };
export const terminalAction = z.union([
  z.object({ type: z.literal('open'), ...streamRef, machineId: opaqueId, threadId: z.uuid(), terminalId: opaqueId, cols: z.number().int().min(2).max(500), rows: z.number().int().min(1).max(300), mode: z.enum(['observe', 'control']), takeover: z.boolean() }).strict(),
  z.object({ type: z.literal('open'), ...streamRef, machineId: opaqueId, tabId: opaqueId, terminalId: opaqueId, cols: z.number().int().min(2).max(500), rows: z.number().int().min(1).max(300), mode: z.enum(['observe', 'control']), takeover: z.boolean() }).strict(),
  z.object({ type: z.literal('ack'), ...streamRef, seq: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('release'), ...streamRef }).strict(),
  z.object({ type: z.literal('input'), ...streamRef, text: z.string().min(1).max(8192), paste: z.boolean() }).strict(),
  z.object({ type: z.literal('resize'), ...streamRef, cols: z.number().int().min(2).max(500), rows: z.number().int().min(1).max(300) }).strict(),
  z.object({ type: z.literal('scroll'), ...streamRef, direction: z.enum(['up', 'down']), lines: z.number().int().min(1).max(100), column: z.number().int().min(1).max(500).optional(), row: z.number().int().min(1).max(300).optional() }).strict(),
  z.object({ type: z.literal('mouse'), ...streamRef, action: z.enum(['down', 'up', 'drag', 'move']), button: z.enum(['left', 'right', 'middle']), column: z.number().int().min(0).max(499), row: z.number().int().min(0).max(299), modifiers: z.number().int().min(0).max(7) }).strict(),
]);
export type TerminalAction = z.infer<typeof terminalAction>;
