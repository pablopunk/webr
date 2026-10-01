import type { TargetAdapter } from '../../src/server/runtime/target';
import type { NativeSnapshot } from '../../src/server/protocol/native';
import { nativeSnapshot } from '../../src/server/protocol/native';
import type { TerminalFrame } from '../../src/server/terminal/cli';
import type { LaunchInput } from '../../src/shared/runtime';

export function snapshot(): NativeSnapshot {
  return nativeSnapshot.parse({ version: '0.9.3', protocol: 22, workspaces: [{ workspace_id: 'w1', label: 'Fixture', worktree: { repo_key: 'fixture', repo_name: 'fixture', repo_root: '/fixture', checkout_path: '/fixture', is_linked_worktree: false } }], tabs: [{ tab_id: 'w1:t1', workspace_id: 'w1', label: 'Fixture tab' }], panes: [{ pane_id: 'w1:p1', terminal_id: 'term_fixture', workspace_id: 'w1', tab_id: 'w1:t1', focused: true, revision: 1, agent_status: 'idle', cwd: '/fixture' }], layouts: [{ workspace_id: 'w1', tab_id: 'w1:t1', area: { x: 0, y: 0, width: 80, height: 24 }, panes: [{ pane_id: 'w1:p1', rect: { x: 0, y: 0, width: 80, height: 24 } }] }], agents: [] });
}
export class FakeTarget implements TargetAdapter {
  id = 'fixture'; name = 'Fixture'; session = 'fixture'; writable = true;
  locations = [{ projectId: 'project', path: '/fixture', workspaceId: 'w1' }];
  state = snapshot(); subscriptions = 0; reads = 0; closed = 0;
  event?: () => void; lost?: (reason: string) => void;
  readHook?: () => Promise<NativeSnapshot>;
  effects: string[] = [];
  failure?: string;
  streams: { onFrame: (frame: TerminalFrame) => void; closed: boolean; commands: Record<string, unknown>[] }[] = [];
  async subscribe(onEvent: () => void, onClose: (reason: string) => void) {
    ++this.subscriptions; this.event = onEvent; this.lost = onClose;
    return () => { this.event = undefined; this.lost = undefined; };
  }
  async snapshot() { ++this.reads; return this.readHook ? this.readHook() : structuredClone(this.state); }
  async catalog() { return { id: this.id, name: this.name, session: this.session, connected: true, writable: true, projectPaths: { project: '/fixture' }, harnesses: [{ id: 'claude', name: 'Claude Code', models: ['Default', 'host/model'], launchEnabled: true }] }; }
  openTerminal: TargetAdapter['openTerminal'] = (_terminal, _mode, _cols, _rows, _takeover, onFrame, _onClose) => {
    const stream = { onFrame, closed: false, commands: [] as Record<string, unknown>[] }; this.streams.push(stream);
    return { send: (command) => { if (stream.closed) throw new Error('closed'); stream.commands.push(command); }, close: () => { stream.closed = true; } };
  };
  private effect(name: string) {
    if (this.failure === name + ':before') throw new Error('fixture_before');
    this.effects.push(name);
    if (this.failure === name + ':after') throw new Error('fixture_ambiguous');
  }
  async create(input: LaunchInput, threadId: string) {
    this.effect('checkout');
    const terminalId = 'term_' + threadId;
    const pane = { ...this.state.panes[0], pane_id: 'w1:p2', terminal_id: terminalId, tab_id: 'w1:t2', agent: null };
    this.state.tabs.push({ tab_id: 'w1:t2', workspace_id: 'w1', label: input.prompt }); this.state.panes.push(pane);
    this.state.layouts.push({ workspace_id: 'w1', tab_id: 'w1:t2', area: { x: 0, y: 0, width: 80, height: 24 }, panes: [{ pane_id: pane.pane_id, rect: { x: 0, y: 0, width: 80, height: 24 } }] });
    return { tabId: 'w1:t2', paneId: pane.pane_id, terminalId, workspaceId: 'w1' };
  }
  async start(_input: LaunchInput, paneId: string) { this.effect('start'); this.state.panes.find((pane) => pane.pane_id === paneId)!.agent = 'claude'; }
  async prompt(paneId: string, _prompt: string, terminalId: string) { if (!this.state.panes.some((pane) => pane.pane_id === paneId && pane.terminal_id === terminalId && pane.agent === 'claude')) throw new Error('occupant_changed'); this.effect('prompt'); }
  close() { ++this.closed; }
}
export const launch: LaunchInput = { machineId: 'fixture', projectId: 'project', prompt: 'Test launch', agent: 'claude', model: 'Default', worktree: true };
export const frame = (seq = 1, full = true, size = 32): TerminalFrame => ({ seq, full, width: 80, height: 24, bytes: Buffer.alloc(size, 65) });
