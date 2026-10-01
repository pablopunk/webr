import type { WebSocket } from 'ws';
import type { RuntimeManager } from '../runtime/manager';
import { encodeFrame, FrameSequence } from '../../shared/frame';
import type { TerminalAction } from '../../shared/runtime';
import type { TerminalStream } from './cli';
import { encodeUserInput } from './writer';

type Lease = { id: number; generation: number; terminalId: string; machineId: string; threadId: string; mode: string; stream?: TerminalStream; outstanding: Map<number, number>; bytes: number; sequence: FrameSequence; baselineReady: boolean; baselineSeq?: number; expectedSize?: [number, number]; timer?: ReturnType<typeof setTimeout> };
export class TerminalHub {
  private viewers = new Map<string, { socket: WebSocket; leases: Map<number, Lease>; bytes: number }>();
  private controllers = new Map<string, { owner: string; id: number }>();
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
      const controller = this.controllers.get(controllerKey);
      if (action.mode === 'control' && controller) {
        if (!action.takeover) throw new Error('controller_conflict');
        this.release(controller.owner, controller.id, 'taken_over');
      }
      const lease: Lease = { id: action.streamId, generation: action.generation, machineId: action.machineId, threadId: action.threadId, terminalId: action.terminalId, mode: action.mode, outstanding: new Map(), bytes: 0, sequence: new FrameSequence(), baselineReady: false };
      viewer.leases.set(lease.id, lease);
      if (action.mode === 'control') this.controllers.set(controllerKey, { owner, id: lease.id });
      try {
        lease.stream = target.openTerminal(action.terminalId, action.mode, action.cols, action.rows, action.takeover, (frame) => {
          if (viewer.leases.get(lease.id) !== lease) return;
          try {
            lease.sequence.accept({ ...frame, streamId: lease.id, generation: lease.generation });
            const packet = encodeFrame({ ...frame, streamId: lease.id, generation: lease.generation });
            if (lease.bytes + packet.length > this.streamBudget || viewer.bytes + packet.length > this.totalBudget || viewer.socket.bufferedAmount + packet.length > this.totalBudget) throw new Error('viewer_overload');
            lease.outstanding.set(frame.seq, packet.length); lease.bytes += packet.length; viewer.bytes += packet.length;
            if (frame.full && !lease.baselineReady && (!lease.expectedSize || frame.width === lease.expectedSize[0] && frame.height === lease.expectedSize[1])) lease.baselineSeq = frame.seq;
            lease.timer ??= setTimeout(() => this.release(owner, lease.id, 'ack_timeout'), 5000);
            viewer.socket.send(packet, { binary: true });
          } catch { this.release(owner, lease.id, 'stream_resync_required'); }
        }, (reason) => this.release(owner, lease.id, reason));
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
  stats() { return { viewers: this.viewers.size, controllers: this.controllers.size, bytes: [...this.viewers.values()].reduce((total, viewer) => total + viewer.bytes, 0) }; }
  private release(owner: string, id: number, reason: string) {
    const viewer = this.viewers.get(owner);
    const lease = viewer?.leases.get(id);
    if (!viewer || !lease) return;
    viewer.leases.delete(id); viewer.bytes -= lease.bytes; clearTimeout(lease.timer);
    const key = lease.machineId + '\0' + lease.terminalId;
    if (this.controllers.get(key)?.owner === owner && this.controllers.get(key)?.id === id) this.controllers.delete(key);
    lease.stream?.close();
    this.notice(viewer.socket, { type: 'stream.closed', streamId: id, generation: lease.generation, reason });
  }
  private notice(socket: WebSocket, value: Record<string, unknown>) { if (socket.readyState === 1) socket.send(JSON.stringify(value)); }
}
