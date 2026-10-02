import type { Machine } from '../../lib/machines';
import type { NativeSnapshot } from '../protocol/native';
import type { TerminalFrame, TerminalStream } from '../terminal/cli';
import type { LaunchInput } from '../../shared/runtime';
import type { Icon } from '../transport/icons';

export type LaunchLocation = { projectId: string; localId?: string; logicalId?: string; path: string; workspaceId: string };
export type TargetAdapter = {
  id: string; session: string; name: string;
  fingerprint: string;
  configVersion: number;
  enabled?: boolean;
  locations: LaunchLocation[];
  writable: boolean;
  acceptsLocalFiles?: boolean;
  subscribe(onEvent: () => void, onClose: (reason: string) => void, paneIds?: string[]): Promise<() => void>;
  snapshot(): Promise<NativeSnapshot>;
  catalog(projectId?: string): Promise<Machine>;
  canLaunch?(input: LaunchInput): boolean;
  icon?(projectId: string): Promise<Icon | undefined>;
  createWorkspace?(path: string, label: string, requestId: string): Promise<{ workspaceId: string; tabId: string; terminalId: string }>;
  openTerminal(terminalId: string, mode: 'control' | 'observe', cols: number, rows: number, takeover: boolean, onFrame: (frame: TerminalFrame) => void, onClose: (reason: string) => void): TerminalStream;
  create(input: LaunchInput, threadId: string): Promise<{ tabId: string; paneId: string; terminalId: string; workspaceId: string }>;
  start(input: LaunchInput, paneId: string, threadId: string): Promise<void>;
  prompt(paneId: string, prompt: string, terminalId: string, threadId: string, input: LaunchInput): Promise<void>;
  close(): void;
};
