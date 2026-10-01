import type { Machine } from '../../lib/machines';
import type { NativeSnapshot } from '../protocol/native';
import type { TerminalFrame, TerminalStream } from '../terminal/cli';
import type { LaunchInput } from '../../shared/runtime';

export type LaunchLocation = { projectId: string; path: string; workspaceId: string };
export type TargetAdapter = {
  id: string; session: string; name: string;
  locations: LaunchLocation[];
  writable: boolean;
  subscribe(onEvent: () => void, onClose: (reason: string) => void): Promise<() => void>;
  snapshot(): Promise<NativeSnapshot>;
  catalog(): Promise<Machine>;
  openTerminal(terminalId: string, mode: 'control' | 'observe', cols: number, rows: number, takeover: boolean, onFrame: (frame: TerminalFrame) => void, onClose: (reason: string) => void): TerminalStream;
  create(input: LaunchInput, threadId: string): Promise<{ tabId: string; paneId: string; terminalId: string; workspaceId: string }>;
  start(input: LaunchInput, paneId: string, threadId: string): Promise<void>;
  prompt(paneId: string, prompt: string, terminalId: string): Promise<void>;
  close(): void;
};
