import { Buffer } from 'node:buffer';
import { schemaFixture } from './schema';
import { nativeSnapshot, type NativeSnapshot } from '../../src/server/protocol/native';
import { targetFingerprint } from '../../src/server/transport/identity';
import type { ValidatorTransport, ValidationMethod, OwnedResource, Scratch, RecorderState, RecorderCommand, ValidationPeer } from '../../src/server/validation/contracts';
import type { RpcOptions } from '../../src/server/protocol/deadlines';

export class FakeValidator implements ValidatorTransport {
  profile = { id: 'local', name: 'Only existing session', session: 'default', transport: 'local' as const, enabled: true, socket: '/fixture/herdr.sock', locations: [{ projectId: 'repo', path: '/repo', workspaceId: 'wUSER' }] };
  fingerprint = targetFingerprint(this.profile); callerPaneId = 'wUSER:p1'; clock = Date.now(); failure?: string;
  state: NativeSnapshot = nativeSnapshot.parse({ version: '0.9.3', protocol: 22, workspaces: [{ workspace_id: 'wUSER', label: 'Existing user workspace' }], tabs: [{ workspace_id: 'wUSER', tab_id: 'wUSER:t1', label: 'Working' }], panes: [{ workspace_id: 'wUSER', tab_id: 'wUSER:t1', pane_id: 'wUSER:p1', terminal_id: 'term_user', focused: true, revision: 9, agent: 'claude', agent_status: 'working', cwd: '/repo' }], layouts: [], agents: [{ terminal_id: 'term_user', state_change_seq: 10 }] });
  processes = new Map<string, { shell: number; foreground: number; name: string }>([['wUSER:p1', { shell: 1, foreground: 42, name: 'claude' }]]);
  calls: { method: string; params: Record<string, unknown>; options?: RpcOptions }[] = []; peers: ValidationPeer[] = [];
  record?: RecorderState; scratchValue?: Scratch; private index = 0; private controller?: ValidationPeer;
  private agent: Record<string, unknown> = {}; private decoded = ''; private promptAt = 0; outputDelay = 100;
  now() { return this.clock; } async sleep(ms: number) { this.clock += ms; }
  async inspect() {
    if (this.failure === 'inspect') throw new Error('Unsupported installed schema');
    const schema = schemaFixture(); const defs = schema.schemas.request.$defs as Record<string, unknown>;
    for (const [record, fields] of Object.entries({ WorkspaceCreateParams: ['cwd', 'label', 'focus'], WorkspaceCloseParams: ['workspace_id', 'close_group'], PaneSendInputParams: ['pane_id', 'text', 'keys'], PaneReadParams: ['pane_id', 'source', 'format', 'lines', 'strip_ansi'], PaneProcessInfoParams: ['pane_id'], WorktreeRemoveParams: ['workspace_id', 'force'] })) defs[record] = { properties: Object.fromEntries(fields.map((field) => [field, {}])) };
    for (const method of ['workspace.create', 'workspace.close', 'worktree.remove', 'pane.get', 'pane.process_info', 'pane.read', 'pane.send_input']) schema.schemas.request.oneOf.push({ properties: { method: { const: method } } });
    return { version: 'herdr 0.9.3', schema };
  }
  async snapshot() { return structuredClone(this.state); }
  async scratch(nonce: string): Promise<Scratch> { if (this.failure === 'scratch') throw new Error('scratch unavailable'); this.scratchValue = { path: '/fixture/herdr-web-validation-' + nonce + '-owned', nonce, platform: 'linux' }; return this.scratchValue; }
  async recorder(_scratch: Scratch) { return this.record ? structuredClone(this.record) : undefined; }
  async removeScratch(scratch: Scratch) { this.calls.push({ method: 'scratch.remove', params: { path: scratch.path } }); }
  private fault(method: string, phase: string) { if (this.failure === method + ':' + phase) throw new Error('rpc_timeout'); }
  async request(method: ValidationMethod, params: Record<string, unknown>, options?: RpcOptions): Promise<Record<string, unknown>> {
    this.calls.push({ method, params: structuredClone(params), options }); this.fault(method, 'before');
    let result: Record<string, unknown> = { type: 'ok' };
    if (method === 'workspace.create' || method === 'worktree.create') {
      const number = ++this.index; const workspace = { workspace_id: 'wV' + number, label: String(params.label) }; const tab = { workspace_id: workspace.workspace_id, tab_id: workspace.workspace_id + ':t1', label: 'Owned' };
      const pane = { workspace_id: workspace.workspace_id, tab_id: tab.tab_id, pane_id: workspace.workspace_id + ':p1', terminal_id: 'term_owned_' + number, focused: false, revision: 1, agent_status: 'idle' as const, agent: null, cwd: String(params.cwd ?? params.path) };
      this.state.workspaces.push(workspace); this.state.tabs.push(tab); this.state.panes.push(pane); this.processes.set(pane.pane_id, { shell: 100 + number, foreground: 100 + number, name: 'sh' });
      result = { type: method === 'worktree.create' ? 'worktree_created' : 'workspace_created', workspace, tab, root_pane: pane, ...(method === 'worktree.create' ? { worktree: { path: params.path, branch: params.branch, is_linked_worktree: true } } : {}) };
      if (this.failure === 'returned-caller') result = { workspace: this.state.workspaces[0], tab: this.state.tabs[0], root_pane: this.state.panes[0] };
    }
    if (method === 'pane.process_info') {
      const process = this.processes.get(String(params.pane_id))!;
      result = { process_info: { pane_id: params.pane_id, shell_pid: process.shell, foreground_processes: [{ pid: process.foreground, name: process.name }] } };
    }
    if (method === 'pane.send_input') {
      if (String(params.text).startsWith('exec python3')) {
        this.fault('recorder.boot', 'before'); const process = this.processes.get(String(params.pane_id))!; process.foreground += 1000; process.name = 'python3';
        this.record = { nonce: this.scratchValue!.nonce, pid: process.foreground, bytes: '', cols: 80, rows: 24, commands: [] }; this.fault('recorder.boot', 'after');
      } else this.append(String(params.text));
    }
    if (method === 'agent.start') {
      const pane = this.state.panes.find((pane) => pane.pane_id === params.pane_id)!; pane.agent = String(params.kind);
      this.agent = { name: params.name, pane_id: pane.pane_id, terminal_id: pane.terminal_id, agent: params.kind, agent_status: 'idle', interactive_ready: true, cwd: pane.cwd };
      result = { type: 'agent_started', agent: { ...this.agent }, argv: [String(params.kind), ...(params.args as string[])] };
      if (this.failure === 'argv') result.argv = [String(params.kind), '--wrong-model'];
    }
    if (method === 'agent.get') result = { agent: { ...this.agent, agent_status: this.decoded && this.clock < this.promptAt + this.outputDelay ? 'working' : 'idle' } };
    if (method === 'agent.prompt') { this.decoded = Buffer.from(String(params.text).split('only: ').at(-1)!, 'base64').toString(); this.promptAt = this.clock; }
    if (method === 'pane.read') result = { read: { text: params.pane_id === this.agent.pane_id ? this.failure === 'launch-output' || this.clock < this.promptAt + this.outputDelay ? 'Working on validation' : this.decoded : this.record?.commands.at(-1) ?? '' } };
    if (method === 'workspace.close' || method === 'worktree.remove') {
      if (params.close_group || params.force) throw new Error('Unsafe cleanup requested');
      const panes = this.state.panes.filter((pane) => pane.workspace_id === params.workspace_id); for (const pane of panes) this.processes.delete(pane.pane_id);
      this.state.panes = this.state.panes.filter((pane) => pane.workspace_id !== params.workspace_id); this.state.tabs = this.state.tabs.filter((tab) => tab.workspace_id !== params.workspace_id); this.state.workspaces = this.state.workspaces.filter((workspace) => workspace.workspace_id !== params.workspace_id);
    }
    this.fault(method, 'after'); return result;
  }
  private append(text: string) { if (this.record) { this.record.bytes = Buffer.concat([Buffer.from(this.record.bytes, 'base64'), Buffer.from(text)]).toString('base64'); this.emit('BYTES'); } }
  private emit(text: string, full = false) { for (const peer of this.peers) if (!peer.closed) peer.frames.push({ seq: (peer.frames.at(-1)?.seq ?? 0) + 1, full, width: this.record!.cols, height: this.record!.rows, bytes: Buffer.from(text) }); }
  async command(_scratch: Scratch, command: RecorderCommand) {
    if (this.failure === 'query') return;
    if (command.op === 'query') { this.append('\x1b[4;8R'); if (this.failure === 'device-replies' && this.controller) this.append('\x1b[4;8R'); }
    this.record!.commands.push(command.id); this.record!.commands.push(command.text ?? command.id); this.emit(command.text ?? command.id);
  }
  open(_resource: OwnedResource, mode: 'control' | 'observe', takeover = false): ValidationPeer {
    const peer: ValidationPeer = { frames: [], sequenceOk: true,
      send: (command) => {
        if (peer.closed) throw new Error('terminal_closed');
        const text = String(command.text ?? '');
        if (command.type === 'terminal.input') {
          if (text.length > 32_768) { if (this.failure === 'budget') return; peer.close(); throw new Error('input_overload'); }
          if (this.failure === 'keys' && text.startsWith('RAW-') || this.failure === 'unicode' && text.startsWith('UTF8-') || this.failure === 'paste' && text.startsWith('\x1b[200~') || this.failure === 'queue' && text.startsWith('ORDER-')) return;
          this.append(text);
        }
        if (command.type === 'terminal.resize' && this.failure !== 'resize') { this.record!.cols = Number(command.cols); this.record!.rows = Number(command.rows); this.emit('RESIZED', true); }
        if (command.type === 'terminal.mouse' && this.failure !== 'mouse') this.append(`\x1b[<0;4;3${command.action === 'down' ? 'M' : 'm'}`);
        if (command.type === 'terminal.scroll' && this.failure !== 'scroll') this.append('\x1b[<65;1;1M'.repeat(Number(command.lines)));
        if (command.type === 'terminal.release' && this.failure !== 'release') peer.close();
      },
      close: () => { peer.closed ??= 'released'; if (this.controller === peer) this.controller = undefined; },
      disconnect: () => { if (this.failure !== 'disconnect') { peer.closed = 'disconnected'; if (this.controller === peer) this.controller = undefined; } },
    };
    if (mode === 'control' && this.controller && !takeover) peer.closed = this.failure === 'conflict' ? 'unknown_failure' : 'controller_conflict';
    else if (mode === 'control') { if (takeover && this.failure === 'takeover') { peer.closed = 'unknown_failure'; } else { if (this.controller) this.controller.closed = 'taken_over'; this.controller = peer; } }
    this.peers.push(peer);
    if (!peer.closed && this.failure !== 'baseline') peer.frames.push({ seq: 1, full: true, width: this.record!.cols, height: this.record!.rows, bytes: Buffer.from('READY') });
    if (this.failure === 'sequence') peer.sequenceOk = false;
    return peer;
  }
  async close() { for (const peer of this.peers) peer.close(); }
}
