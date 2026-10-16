import type { WebSocket } from 'ws';
import type { RuntimeManager } from '../runtime/manager';
import { encodeFrame, FrameSequence } from '../../shared/frame';
import type { TerminalAction } from '../../shared/runtime';
import type { TerminalFrame, TerminalStream } from './cli';
import { encodeUserInput } from './writer';
import { perfLog } from '../perf-log';
import { serverTrace, traceLog } from '../trace-log';

type TerminalRef = { threadId: string } | { tabId: string };
type Target = ReturnType<RuntimeManager['binding']>;
type Lease = { id: number; generation: number; terminalId: string; machineId: string; ref: TerminalRef; mode: string; target: Target; invalidSince?: number; stream?: TerminalStream; outstanding: Map<number, number>; bytes: number; sequence: FrameSequence; baselineReady: boolean; outputSeq: number; started: boolean; baselineSeq?: number; expectedSize?: [number, number]; timer?: ReturnType<typeof setTimeout>; scrollAt?: number; scrollMode?: { value: 'scrollback' | 'app'; checkedAt: number }; scrolledUp?: boolean; pendingInput: string[]; pendingBytes: number };
const MAX_WHEEL_TICKS = 30;
/** A thread binding can flicker for one projection while Herdr re-reports an agent session; the stream survives that, not a sustained loss. */
const BINDING_GRACE_MS = 2000;
const errorDetail = (error: unknown) => ({ error: error instanceof Error ? error.message : String(error), detail: (error as { detail?: unknown })?.detail });
const isFocusReport = (text: string) => text === '\x1b[I' || text === '\x1b[O';
const SCROLL_MODE_CHECK_MS = 1000;
// First keystrokes (including monitor startup commands) can legitimately arrive
// before the baseline is acknowledged, especially over slower links where a
// layout resize interleaves with the initial baseline. Dropping them leaves an
// empty terminal, so hold them until the baseline is ready instead.
const MAX_PENDING_INPUT_BYTES = 16 * 1024;
type SharedControl = { stream: TerminalStream; sequence: FrameSequence; members: Map<Lease, string>; closed: boolean };
export class TerminalHub {
  private viewers = new Map<string, { socket: WebSocket; leases: Map<number, Lease>; bytes: number }>();
  private controllers = new Map<string, SharedControl>();
  private expiry: ReturnType<typeof setInterval>;
  constructor(private manager: RuntimeManager, private streamBudget = 512 * 1024, private totalBudget = 2 * 1024 * 1024, private bindingGraceMs = BINDING_GRACE_MS) {
    this.expiry = setInterval(() => { for (const [owner, viewer] of this.viewers) for (const lease of [...viewer.leases.values()]) if (lease.mode === 'control') { const target = this.checkBinding(owner, lease); if (target && !target.writable) this.release(owner, lease.id, 'capability_revoked'); } }, 250);
    this.expiry.unref();
    manager.on('projection', () => { for (const [owner, viewer] of this.viewers) for (const lease of [...viewer.leases.values()]) this.checkBinding(owner, lease); });
  }
  /** Re-validates the lease's binding; a lapse shorter than the grace period keeps the last known target instead of dropping the stream. */
  private checkBinding(owner: string, lease: Lease): Target | undefined {
    try {
      lease.target = this.binding(lease);
      if (lease.invalidSince !== undefined) { traceLog([serverTrace('hub.binding.recovered', { terminalId: lease.terminalId, ref: lease.ref, invalidForMs: Date.now() - lease.invalidSince })]); lease.invalidSince = undefined; }
      return lease.target;
    } catch (error) {
      const now = Date.now();
      if (lease.invalidSince === undefined) { lease.invalidSince = now; traceLog([serverTrace('hub.binding.invalid', { terminalId: lease.terminalId, ref: lease.ref, mode: lease.mode, ...errorDetail(error) })]); }
      if (now - lease.invalidSince < this.bindingGraceMs) return lease.target;
      this.release(owner, lease.id, 'binding_invalid', { invalidForMs: now - lease.invalidSince, ...errorDetail(error) });
      return undefined;
    }
  }
  close() { clearInterval(this.expiry); for (const owner of this.viewers.keys()) this.detach(owner); }
  attach(owner: string, socket: WebSocket) { if (this.viewers.has(owner)) throw new Error('duplicate_terminal_socket'); this.viewers.set(owner, { socket, leases: new Map(), bytes: 0 }); }
  detach(owner: string) { const viewer = this.viewers.get(owner); if (!viewer) return; for (const lease of [...viewer.leases.values()]) this.release(owner, lease.id, 'connection_closed'); this.viewers.delete(owner); }
  action(owner: string, action: TerminalAction) {
    const viewer = this.viewers.get(owner);
    if (!viewer) throw new Error('viewer_missing');
    if (action.type === 'open') {
      if (viewer.leases.size >= 16 || viewer.leases.has(action.streamId)) throw new Error('stream_limit');
      const ref: TerminalRef = 'threadId' in action ? { threadId: action.threadId } : { tabId: action.tabId };
      const target = this.manager.terminalBinding(action.machineId, action.terminalId, ref);
      if (action.mode === 'control' && !target.writable) throw new Error('read_only_target');
      const controllerKey = action.machineId + '\0' + action.terminalId;
      const lease: Lease = { id: action.streamId, generation: action.generation, machineId: action.machineId, ref, terminalId: action.terminalId, mode: action.mode, target, outstanding: new Map(), bytes: 0, sequence: new FrameSequence(), baselineReady: false, outputSeq: 0, started: false, pendingInput: [], pendingBytes: 0 };
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
      if (action.seq === lease.baselineSeq && !lease.baselineReady) {
        lease.baselineReady = true;
        for (const text of lease.pendingInput) lease.stream?.send({ type: 'terminal.input', text });
        lease.pendingInput = []; lease.pendingBytes = 0;
      }
      clearTimeout(lease.timer); lease.timer = lease.outstanding.size ? setTimeout(() => this.release(owner, lease.id, 'ack_timeout'), 5000) : undefined;
      return;
    }
    const target = this.checkBinding(owner, lease);
    if (!target) throw new Error('binding_invalid');
    if (lease.mode !== 'control') throw new Error('observer_read_only');
    if (!target.writable) { this.release(owner, lease.id, 'capability_revoked'); throw new Error('read_only_target'); }
    if (action.type !== 'resize' && action.type !== 'input' && !lease.baselineReady) throw new Error('baseline_not_acknowledged');
    if (action.type === 'input') {
      const text = encodeUserInput(action.text, action.paste);
      if (!lease.baselineReady) {
        if (lease.pendingBytes + Buffer.byteLength(text) > MAX_PENDING_INPUT_BYTES) throw new Error('baseline_not_acknowledged');
        lease.pendingInput.push(text); lease.pendingBytes += Buffer.byteLength(text);
      } else lease.stream?.send({ type: 'terminal.input', text });
      if (lease.scrolledUp && !isFocusReport(action.text)) { lease.scrolledUp = false; void target.scrollToBottom?.(lease.terminalId).catch(() => undefined); }
    }
    if (action.type === 'resize') { lease.baselineReady = false; lease.baselineSeq = undefined; lease.expectedSize = [action.cols, action.rows]; lease.stream?.send({ type: 'terminal.resize', cols: action.cols, rows: action.rows }); }
    if (action.type === 'scroll') lease.scrollAt ??= performance.now();
    if (action.type === 'scroll') this.scroll(lease, target, action);
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
      this.logScrollReply(lease, frame.full, packet.length, viewer.socket.bufferedAmount);
    } catch { this.release(owner, lease.id, 'stream_resync_required'); }
  }
  /** Herdr always puts wheel ticks of full-screen apps at the top-left cell, so those get SGR wheel reports at the pointer instead. */
  private scroll(lease: Lease, target: ReturnType<RuntimeManager['binding']>, action: { direction: 'up' | 'down'; lines: number; column?: number; row?: number }) {
    this.refreshScrollMode(lease, target);
    if (lease.scrollMode?.value !== 'app') {
      if (action.direction === 'up') lease.scrolledUp = true;
      lease.stream?.send({ type: 'terminal.scroll', direction: action.direction, lines: action.lines }); return;
    }
    const report = `\x1b[<${action.direction === 'up' ? 64 : 65};${action.column ?? 1};${action.row ?? 1}M`;
    lease.stream?.send({ type: 'terminal.input', text: report.repeat(Math.min(action.lines, MAX_WHEEL_TICKS)) });
  }
  private refreshScrollMode(lease: Lease, target: ReturnType<RuntimeManager['binding']>) {
    if (!target.scrollMode || lease.scrollMode && Date.now() - lease.scrollMode.checkedAt < SCROLL_MODE_CHECK_MS) return;
    lease.scrollMode = { value: lease.scrollMode?.value ?? 'scrollback', checkedAt: Date.now() };
    void target.scrollMode(lease.terminalId).then((value) => { lease.scrollMode = { value, checkedAt: Date.now() }; }, () => undefined);
  }
  private binding(lease: Lease) { return this.manager.terminalBinding(lease.machineId, lease.terminalId, lease.ref); }
  private logScrollReply(lease: Lease, full: boolean, bytes: number, buffered: number) {
    if (lease.scrollAt === undefined) return;
    perfLog('server', { event: 'scroll.reply', herdrRoundTripMs: performance.now() - lease.scrollAt, full, bytes, socketBufferedBytes: buffered });
    lease.scrollAt = undefined;
  }
  stats() { return { viewers: this.viewers.size, controllers: this.controllers.size, bytes: [...this.viewers.values()].reduce((total, viewer) => total + viewer.bytes, 0) }; }
  private release(owner: string, id: number, reason: string, detail: Record<string, unknown> = {}) {
    const viewer = this.viewers.get(owner);
    const lease = viewer?.leases.get(id);
    if (!viewer || !lease) return;
    if (reason !== 'released' && reason !== 'connection_closed') traceLog([serverTrace('hub.release', { terminalId: lease.terminalId, ref: lease.ref, mode: lease.mode, reason, ...detail })]);
    viewer.leases.delete(id); viewer.bytes -= lease.bytes; clearTimeout(lease.timer);
    lease.stream?.close();
    this.notice(viewer.socket, { type: 'stream.closed', streamId: id, generation: lease.generation, reason });
  }
  private notice(socket: WebSocket, value: Record<string, unknown>) { if (socket.readyState === 1) socket.send(JSON.stringify(value)); }
}
