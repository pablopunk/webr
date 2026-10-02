import type { TargetAdapter } from '../../src/server/runtime/target';
import type { NativeSnapshot } from '../../src/server/protocol/native';
import { nativeSnapshot } from '../../src/server/protocol/native';
import type { TerminalFrame } from '../../src/server/terminal/cli';
import type { LaunchInput } from '../../src/shared/runtime';

export function snapshot(): NativeSnapshot {
  return nativeSnapshot.parse({ version: '0.9.3', protocol: 22, workspaces: [{ workspace_id: 'w1', label: 'Fixture', worktree: { repo_key: 'fixture', repo_name: 'fixture', repo_root: '/fixture', checkout_path: '/fixture', is_linked_worktree: false } }], tabs: [{ tab_id: 'w1:t1', workspace_id: 'w1', label: 'Fixture tab' }], panes: [{ pane_id: 'w1:p1', terminal_id: 'term_fixture', workspace_id: 'w1', tab_id: 'w1:t1', focused: true, revision: 1, agent_status: 'idle', cwd: '/fixture' }], layouts: [{ workspace_id: 'w1', tab_id: 'w1:t1', area: { x: 0, y: 0, width: 80, height: 24 }, panes: [{ pane_id: 'w1:p1', rect: { x: 0, y: 0, width: 80, height: 24 } }] }], agents: [] });
}
export class FakeTarget implements TargetAdapter {
  id = 'fixture'; name = 'Fixture'; session = 'fixture'; writable = true; acceptsLocalFiles = true;
  sourceIdentity = 'source-v1'; configVersion = 1; projectPath = '/fixture';
  get fingerprint() { return this.id + ':' + this.sourceIdentity; }
  get locations() { return [{ projectId: this.id + ':project', localId: 'project', logicalId: 'project', path: this.projectPath, workspaceId: 'w1' }]; }
  state = snapshot(); subscriptions = 0; activeSubscriptions = 0; reads = 0; closed = 0;
  event?: () => void; lost?: (reason: string) => void;
  readHook?: () => Promise<NativeSnapshot>;
  effects: string[] = [];
  failure?: string;
  streams: { onFrame: (frame: TerminalFrame) => void; onClose: (reason: string) => void; closed: boolean; commands: Record<string, unknown>[] }[] = [];
  private listeners = new Set<() => void>();
  async subscribe(onEvent: () => void, onClose: (reason: string) => void) {
    ++this.subscriptions; ++this.activeSubscriptions; this.listeners.add(onEvent);
    this.event = () => { for (const listener of this.listeners) listener(); }; this.lost = onClose;
    let active = true;
    return () => { if (active) { --this.activeSubscriptions; this.listeners.delete(onEvent); active = false; } };
  }
  async snapshot() { ++this.reads; return this.readHook ? this.readHook() : structuredClone(this.state); }
  async catalog() { return { id: this.id, name: this.name, session: this.session, connected: true, writable: true, projectPaths: Object.fromEntries(this.locations.map((location) => [location.projectId, location.path])), harnesses: [{ id: 'claude', name: 'Claude Code', models: ['Default', 'host/model'], launchEnabled: true }] }; }
  openTerminal: TargetAdapter['openTerminal'] = (_terminal, _mode, _cols, _rows, _takeover, onFrame, onClose) => {
    const stream = { onFrame, onClose, closed: false, commands: [] as Record<string, unknown>[] }; this.streams.push(stream);
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
  focused: string[] = [];
  async focusPane(paneId: string) { this.focused.push(paneId); }
  async splitTerminal(paneId: string, direction: 'right' | 'down') {
    this.effect('split:' + direction); const source = this.state.panes.find((pane) => pane.pane_id === paneId)!;
    const pane = { ...source, pane_id: source.pane_id + 's', terminal_id: source.terminal_id + '_shell', agent: null, focused: false }; this.state.panes.push(pane);
    const layout = this.state.layouts.find((layout) => layout.tab_id === source.tab_id)!; layout.panes.push({ pane_id: pane.pane_id, rect: direction === 'right' ? { x: 52, y: 0, width: 28, height: 24 } : { x: 0, y: 16, width: 80, height: 8 } });
    return pane.pane_id;
  }
  async closePane(paneId: string) { this.effect('close:' + paneId); this.state.panes = this.state.panes.filter((pane) => pane.pane_id !== paneId); }
  async discardTab(tabId: string, _removeWorktree = false) { this.effect('discard:' + tabId); this.state.panes = this.state.panes.filter((pane) => pane.tab_id !== tabId); this.state.tabs = this.state.tabs.filter((tab) => tab.tab_id !== tabId); }
  close() { ++this.closed; }
}
export const launch: LaunchInput = { machineId: 'fixture', projectId: 'fixture:project', prompt: 'Test launch', agent: 'claude', model: 'Default', worktree: true };
export const frame = (seq = 1, full = true, size = 32): TerminalFrame => ({ seq, full, width: 80, height: 24, bytes: Buffer.alloc(size, 65) });
