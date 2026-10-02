import type { WebSocket } from 'ws';
import type { RuntimeManager } from '../runtime/manager';
import { encodeFrame, FrameSequence } from '../../shared/frame';
import type { TerminalAction } from '../../shared/runtime';
import type { TerminalFrame, TerminalStream } from './cli';
import { encodeUserInput } from './writer';

type Lease = { id: number; generation: number; terminalId: string; machineId: string; threadId: string; mode: string; stream?: TerminalStream; outstanding: Map<number, number>; bytes: number; sequence: FrameSequence; baselineReady: boolean; outputSeq: number; started: boolean; baselineSeq?: number; expectedSize?: [number, number]; timer?: ReturnType<typeof setTimeout> };
type SharedControl = { stream: TerminalStream; sequence: FrameSequence; members: Map<Lease, string>; closed: boolean };
export class TerminalHub {
  private viewers = new Map<string, { socket: WebSocket; leases: Map<number, Lease>; bytes: number }>();
  private controllers = new Map<string, SharedControl>();
  private expiry: ReturnType<typeof setInterval>;
  constructor(private manager: RuntimeManager, private streamBudget = 512 * 1024, private totalBudget = 2 * 1024 * 1024) {
    this.expiry = setInterval(() => { for (const [owner, viewer] of this.viewers) for (const lease of viewer.leases.values()) if (lease.mode === 'control') { try { if (!manager.binding(lease.machineId, lease.threadId, lease.terminalId).writable) this.release(owner, lease.id, 'capability_revoked'); } catch { this.release(owner, lease.id, 'binding_invalid'); } } }, 250);
    this.expiry.unref();
    manager.on('projection', () => { for (const [owner, viewer] of this.viewers) for (const lease of viewer.leases.values()) { try { manager.binding(lease.machineId, lease.threadId, lease.terminalId); } catch { this.release(owner, lease.id, 'binding_invalid'); } } });
  }
  close() { clearInterval(this.expiry); for (const owner of this.viewers.keys()) this.detach(owner); }
  attach(owner: string, socket: WebSocket) { if (this.viewers.has(owner)) throw new Error('duplicate_terminal_socket'); this.viewers.set(owner, { socket, leases: new Map(), bytes: 0 }); }
  detach(owner: string) { const viewer = this.viewers.get(owner); if (!viewer) return; for (const lease of [...viewer.leases.values()]) this.release(owner, lease.id, 'connection_closed'); this.viewers.delete(owner); }
  action(owner: string, action: TerminalAction) {
    const viewer = this.viewers.get(owner);
    if (!viewer) throw new Error('viewer_missing');
    if (action.type === 'open') {
      if (viewer.leases.size >= 16 || viewer.leases.has(action.streamId)) throw new Error('stream_limit');
      const target = this.manager.binding(action.machineId, action.threadId, action.terminalId);
      if (action.mode === 'control' && !target.writable) throw new Error('read_only_target');
      const controllerKey = action.machineId + '\0' + action.terminalId;
      const lease: Lease = { id: action.streamId, generation: action.generation, machineId: action.machineId, threadId: action.threadId, terminalId: action.terminalId, mode: action.mode, outstanding: new Map(), bytes: 0, sequence: new FrameSequence(), baselineReady: false, outputSeq: 0, started: false };
      viewer.leases.set(lease.id, lease);
      try {
        lease.stream = action.mode === 'control'
          ? this.joinControl(controllerKey, owner, lease, action, target)
          : target.openTerminal(action.terminalId, action.mode, action.cols, action.rows, action.takeover, (frame) => this.deliver(owner, lease, frame), (reason) => this.release(owner, lease.id, reason));
        if (viewer.leases.get(lease.id) !== lease) lease.stream.close();
        else this.notice(viewer.socket, { type: 'stream.opened', streamId: lease.id, generation: lease.generation, writable: action.mode === 'control' });
      } catch (error) { this.release(owner, lease.id, 'open_failed'); throw error; }
      return;
    }
    const lease = viewer.leases.get(action.streamId);
    if (!lease || lease.generation !== action.generation) throw new Error('stale_lease');
    if (action.type === 'release') { this.release(owner, lease.id, 'released'); return; }
    if (action.type === 'ack') {
      const bytes = lease.outstanding.get(action.seq);
      if (!bytes || lease.outstanding.keys().next().value !== action.seq) throw new Error('invalid_ack');
      lease.outstanding.delete(action.seq); lease.bytes -= bytes; viewer.bytes -= bytes;
      if (action.seq === lease.baselineSeq) lease.baselineReady = true;
      clearTimeout(lease.timer); lease.timer = lease.outstanding.size ? setTimeout(() => this.release(owner, lease.id, 'ack_timeout'), 5000) : undefined;
      return;
    }
    const target = this.manager.binding(lease.machineId, lease.threadId, lease.terminalId);
    if (lease.mode !== 'control') throw new Error('observer_read_only');
    if (!target.writable) { this.release(owner, lease.id, 'capability_revoked'); throw new Error('read_only_target'); }
    if (action.type !== 'resize' && !lease.baselineReady) throw new Error('baseline_not_acknowledged');
    if (action.type === 'input') lease.stream?.send({ type: 'terminal.input', text: encodeUserInput(action.text, action.paste) });
    if (action.type === 'resize') { lease.baselineReady = false; lease.baselineSeq = undefined; lease.expectedSize = [action.cols, action.rows]; lease.stream?.send({ type: 'terminal.resize', cols: action.cols, rows: action.rows }); }
    if (action.type === 'scroll') lease.stream?.send({ type: 'terminal.scroll', direction: action.direction, lines: action.lines });
    if (action.type === 'mouse') lease.stream?.send({ type: 'terminal.mouse', action: action.action, button: action.button, column: action.column, row: action.row, modifiers: action.modifiers });
  }
  private joinControl(key: string, owner: string, lease: Lease, action: Extract<TerminalAction, { type: 'open' }>, target: ReturnType<RuntimeManager['binding']>): TerminalStream {
    let shared = this.controllers.get(key);
    if (shared) {
      shared.members.set(lease, owner); lease.expectedSize = [action.cols, action.rows];
      shared.stream.send({ type: 'terminal.resize', cols: action.cols, rows: action.rows });
    } else {
      const created: SharedControl = { stream: undefined as unknown as TerminalStream, sequence: new FrameSequence(), members: new Map([[lease, owner]]), closed: false };
      this.controllers.set(key, created);
      try { created.stream = target.openTerminal(action.terminalId, 'control', action.cols, action.rows, action.takeover, (frame) => this.fanOut(key, created, frame), (reason) => this.closeShared(key, created, reason)); }
      catch (error) { this.controllers.delete(key); throw error; }
      shared = created;
    }
    const joined = shared;
    return { send: (command) => joined.stream.send(command), close: () => this.leave(key, joined, lease) };
  }
  private leave(key: string, shared: SharedControl, lease: Lease) {
    shared.members.delete(lease);
    if (shared.members.size || shared.closed) return;
    shared.closed = true;
    if (this.controllers.get(key) === shared) this.controllers.delete(key);
    shared.stream.close();
  }
  private closeShared(key: string, shared: SharedControl, reason: string) {
    shared.closed = true;
    if (this.controllers.get(key) === shared) this.controllers.delete(key);
    const members = [...shared.members]; shared.members.clear();
    for (const [lease, owner] of members) this.release(owner, lease.id, reason);
  }
  private fanOut(key: string, shared: SharedControl, frame: TerminalFrame) {
    try { shared.sequence.accept({ ...frame, streamId: 0, generation: 0 }); } catch { shared.stream.close(); this.closeShared(key, shared, 'stream_resync_required'); return; }
    for (const [lease, owner] of [...shared.members]) this.deliver(owner, lease, frame);
  }
  private deliver(owner: string, lease: Lease, upstream: TerminalFrame) {
    const viewer = this.viewers.get(owner);
    if (!viewer || viewer.leases.get(lease.id) !== lease) return;
    if (!lease.started) { if (!upstream.full) return; lease.started = true; }
    const frame = { ...upstream, seq: ++lease.outputSeq, streamId: lease.id, generation: lease.generation };
    try {
      lease.sequence.accept(frame);
      const packet = encodeFrame(frame);
      if (lease.bytes + packet.length > this.streamBudget || viewer.bytes + packet.length > this.totalBudget || viewer.socket.bufferedAmount + packet.length > this.totalBudget) throw new Error('viewer_overload');
      lease.outstanding.set(frame.seq, packet.length); lease.bytes += packet.length; viewer.bytes += packet.length;
      if (frame.full && !lease.baselineReady && (!lease.expectedSize || frame.width === lease.expectedSize[0] && frame.height === lease.expectedSize[1])) lease.baselineSeq = frame.seq;
      lease.timer ??= setTimeout(() => this.release(owner, lease.id, 'ack_timeout'), 5000);
      viewer.socket.send(packet, { binary: true });
    } catch { this.release(owner, lease.id, 'stream_resync_required'); }
  }
  stats() { return { viewers: this.viewers.size, controllers: this.controllers.size, bytes: [...this.viewers.values()].reduce((total, viewer) => total + viewer.bytes, 0) }; }
  private release(owner: string, id: number, reason: string) {
    const viewer = this.viewers.get(owner);
    const lease = viewer?.leases.get(id);
    if (!viewer || !lease) return;
    viewer.leases.delete(id); viewer.bytes -= lease.bytes; clearTimeout(lease.timer);
    lease.stream?.close();
    this.notice(viewer.socket, { type: 'stream.closed', streamId: id, generation: lease.generation, reason });
  }
  private notice(socket: WebSocket, value: Record<string, unknown>) { if (socket.readyState === 1) socket.send(JSON.stringify(value)); }
}
