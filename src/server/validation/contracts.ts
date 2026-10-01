import type { TargetProfile } from '../transport/registry';
import type { NativeSnapshot } from '../protocol/native';
import type { TerminalFrame } from '../terminal/cli';
import type { RpcOptions } from '../protocol/deadlines';

export const validationMethods = new Set(['ping', 'session.snapshot', 'workspace.create', 'workspace.close', 'worktree.create', 'worktree.remove', 'pane.get', 'pane.process_info', 'pane.read', 'pane.send_input', 'agent.start', 'agent.get', 'agent.prompt']);
export type ValidationMethod = 'ping' | 'session.snapshot' | 'workspace.create' | 'workspace.close' | 'worktree.create' | 'worktree.remove' | 'pane.get' | 'pane.process_info' | 'pane.read' | 'pane.send_input' | 'agent.start' | 'agent.get' | 'agent.prompt';
export type OwnedResource = { kind: 'recorder' | 'source' | 'checkout'; workspaceId: string; tabId: string; paneId: string; terminalId: string; label: string; path: string; branch?: string; pid?: number; shellName?: string; agentName?: string; harness?: string };
export type Scratch = { path: string; nonce: string; platform: 'linux' | 'darwin' };
export type RecorderState = { nonce: string; pid: number; bytes: string; cols: number; rows: number; commands: string[] };
export type RecorderCommand = { id: string; op: 'emit' | 'query'; text?: string };
export type ValidationPeer = { frames: TerminalFrame[]; sequenceOk: boolean; closed?: string; send(command: Record<string, unknown>): void; close(): void; disconnect(): void };
export type ValidatorTransport = {
  profile: TargetProfile;
  fingerprint: string;
  callerPaneId: string;
  inspect(): Promise<{ version: string; schema: unknown }>;
  snapshot(): Promise<NativeSnapshot>;
  request(method: ValidationMethod, params: Record<string, unknown>, options?: RpcOptions): Promise<Record<string, unknown>>;
  scratch(nonce: string): Promise<Scratch>;
  recorder(scratch: Scratch): Promise<RecorderState | undefined>;
  command(scratch: Scratch, command: RecorderCommand): Promise<void>;
  removeScratch(scratch: Scratch): Promise<void>;
  open(resource: OwnedResource, mode: 'control' | 'observe', takeover?: boolean): ValidationPeer;
  now(): number;
  sleep(ms: number): Promise<void>;
  close(): Promise<void>;
};
export type ValidatorOptions = { consent: boolean; control: boolean; launch?: { harness: 'claude' | 'codex' | 'opencode'; model: string; projectId: string }; outputDirectory: string; signingKey?: string; approve?: boolean };
