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
export type Rect = { x: number; y: number; width: number; height: number };
export type Layout = { workspaceId: string; tabId: string; area: Rect; panes: { paneId: string; rect: Rect }[] };
export type Projection = {
  machineId: string; generation: string; revision: number; freshAt: string | null;
  connected: boolean; error?: string; threads: Thread[]; projects: Project[]; layouts: Layout[];
  availableTabs?: { tabId: string; workspaceId: string; label: string; bound: boolean; panes: { id: string; terminalId: string; title: string }[] }[];
  machine?: Machine;
};
export type Bootstrap = { projections: Projection[]; machines: Machine[]; projects: Project[]; threads: Thread[] };
const streamRef = { streamId: z.number().int().min(1).max(0xffffffff), generation: z.number().int().min(1).max(0xffffffff) };
export const terminalAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('open'), ...streamRef, machineId: opaqueId, threadId: z.uuid(), terminalId: opaqueId, cols: z.number().int().min(2).max(500), rows: z.number().int().min(1).max(300), mode: z.enum(['observe', 'control']), takeover: z.boolean() }).strict(),
  z.object({ type: z.literal('ack'), ...streamRef, seq: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('release'), ...streamRef }).strict(),
  z.object({ type: z.literal('input'), ...streamRef, text: z.string().min(1).max(8192), paste: z.boolean() }).strict(),
  z.object({ type: z.literal('resize'), ...streamRef, cols: z.number().int().min(2).max(500), rows: z.number().int().min(1).max(300) }).strict(),
  z.object({ type: z.literal('scroll'), ...streamRef, direction: z.enum(['up', 'down']), lines: z.number().int().min(1).max(100), column: z.number().int().min(1).max(500).optional(), row: z.number().int().min(1).max(300).optional() }).strict(),
  z.object({ type: z.literal('mouse'), ...streamRef, action: z.enum(['down', 'up', 'drag', 'move']), button: z.enum(['left', 'right', 'middle']), column: z.number().int().min(0).max(499), row: z.number().int().min(0).max(299), modifiers: z.number().int().min(0).max(7) }).strict(),
]);
export type TerminalAction = z.infer<typeof terminalAction>;
