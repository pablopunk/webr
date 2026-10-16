import type { Terminal } from '@xterm/xterm';
import type { Projection, TerminalAction } from '../shared/runtime';
import { decodeFrame, FrameSequence } from '../shared/frame';
import { TerminalRenderer } from './terminal-renderer';
import { retryDelay } from '../shared/retry';
import { count, gauge, perfNow, time } from './perf';
import { uuid } from '../lib/uuid';
import { trace } from './trace';

type VisiblePane = { machineId: string; threadId?: string; tabId?: string; terminalId: string; terminal: Terminal; mode: 'observe' | 'control'; generation: number; sequence: FrameSequence; renderer?: TerminalRenderer; writable: boolean; accepted: boolean; baseline: boolean; pending: number; resizing: boolean; awaitingFresh: boolean; pendingControl: boolean; reason?: string; cols: number; rows: number; onState: (message: string, writable: boolean, typeable?: boolean) => void; attempts: number; wantsControl: boolean };
const controlWasRefused = (reason: unknown) => reason === 'controller_conflict' || reason === 'taken_over';
/** Control was granted, so keystrokes may go out even while a (re)sized baseline is still on its way: the server holds them until it lands. */
const typeable = (pane: VisiblePane) => pane.mode === 'control' && pane.accepted;
export const conflictMessage = 'Another controller owns this terminal.';
export class BrowserTerminalManager {
  private metadata?: WebSocket;
  private binary?: WebSocket;
  private stopped = true;
  private epoch = 0;
  private nextId = 1;
  private panes = new Map<number, VisiblePane>();
  private reconnect?: ReturnType<typeof setTimeout>;
  private instance = '';
  private failures = 0;
  private connectedAt = 0;
  private scrollSentAt = new Map<number, number>();
  private inputSentAt = new Map<number, number>();
  private openedAt = new Map<number, number>();
  private projectionFresh = new Map<string, boolean>();
  private projections = new Map<string, Projection>();
  private projectionGenerations = new Map<string, string>();
  private retiredGenerations = new Map<string, Set<string>>();
  constructor(private install: (projection: Projection) => boolean | void, private onConnection: (connected: boolean) => void) {}
  start() { this.stopped = false; this.connect(); }
  stop() { this.stopped = true; clearTimeout(this.reconnect); this.disconnect(); }
  mount(pane: Omit<VisiblePane, 'generation' | 'sequence' | 'writable' | 'attempts' | 'accepted' | 'baseline' | 'pending' | 'resizing' | 'awaitingFresh' | 'pendingControl' | 'wantsControl'>) {
    const id = this.nextId++;
    this.panes.set(id, { ...pane, wantsControl: pane.mode === 'control', generation: 1, sequence: new FrameSequence(), writable: false, accepted: false, baseline: false, pending: 0, resizing: false, awaitingFresh: false, pendingControl: false, attempts: 0 });
    this.open(id);
    return {
      close: () => { const current = this.panes.get(id); if (current) { this.send({ type: 'release', streamId: id, generation: current.generation }); current.renderer?.close(); } this.panes.delete(id); },
      input: (text: string, paste = false) => { const current = this.panes.get(id); if (current && typeable(current)) { count('inputMessages'); this.inputSentAt.set(id, perfNow()); this.send({ type: 'input', streamId: id, generation: current.generation, text, paste }); } },
      control: (takeover = false) => { const current = this.panes.get(id); if (current) current.wantsControl = true; if (current && this.canAct(current) && (current.mode !== 'control' || takeover)) { this.send({ type: 'release', streamId: id, generation: current.generation }); current.reason = undefined; current.mode = 'control'; ++current.generation; current.sequence = new FrameSequence(); this.open(id, takeover); } },
      observe: () => { const current = this.panes.get(id); if (current) current.wantsControl = false; if (current && current.mode !== 'observe') { this.send({ type: 'release', streamId: id, generation: current.generation }); current.mode = 'observe'; ++current.generation; current.sequence = new FrameSequence(); this.open(id); } },
      resize: (cols: number, rows: number, claim = false) => {
        const current = this.panes.get(id);
        if (!current || cols === current.cols && rows === current.rows && !(claim && current.mode === 'control' && current.accepted)) return;
        current.cols = cols; current.rows = rows;
        if (!this.canAct(current)) return;
        trace('stream.resize', { terminalId: current.terminalId, cols, rows, claim, accepted: current.accepted });
        if (current.mode === 'control' && current.accepted) { current.writable = false; current.baseline = false; current.resizing = true; current.onState('Waiting for the resized full baseline.', false, true); this.send({ type: 'resize', streamId: id, generation: current.generation, cols, rows }); }
        else { this.send({ type: 'release', streamId: id, generation: current.generation }); ++current.generation; current.sequence = new FrameSequence(); this.open(id); }
      },
      scroll: (direction: 'up' | 'down', lines: number, column?: number, row?: number) => { const current = this.panes.get(id); if (current?.writable) { count('scrollMessages'); this.scrollSentAt.set(id, perfNow()); this.send({ type: 'scroll', streamId: id, generation: current.generation, direction, lines, column, row }); } },
      mouse: (action: 'down' | 'up' | 'drag' | 'move', button: 'left' | 'right' | 'middle', column: number, row: number, modifiers: number) => { const current = this.panes.get(id); if (current?.writable) this.send({ type: 'mouse', streamId: id, generation: current.generation, action, button, column, row, modifiers }); },
    };
  }
  command(machineId: string, threadId: string, terminalId: string, action: 'control' | 'takeover' | 'release') {
    const entry = [...this.panes.entries()].find(([, pane]) => pane.machineId === machineId && pane.threadId === threadId && pane.terminalId === terminalId);
    if (!entry) return;
    const [id, pane] = entry;
    if (!this.canAct(pane)) return;
    pane.writable = false; pane.reason = undefined; this.send({ type: 'release', streamId: id, generation: pane.generation });
    pane.wantsControl = action !== 'release'; pane.mode = action === 'release' ? 'observe' : 'control'; ++pane.generation; pane.sequence = new FrameSequence(); this.open(id, action === 'takeover');
  }
  private canAct(pane: VisiblePane) {
    const projection = this.projections.get(pane.machineId);
    return this.metadata?.readyState === WebSocket.OPEN && this.binary?.readyState === WebSocket.OPEN
      && this.projectionFresh.get(pane.machineId) === true && !!projection && this.projectionContains(pane, projection);
  }
  private projectionContains(pane: VisiblePane, projection: Projection) {
    if (pane.threadId) return projection.threads.some((thread) => thread.id === pane.threadId && thread.bindingState === 'attached' && thread.panes.some((item) => item.terminalId === pane.terminalId));
    return projection.availableTabs?.some((tab) => tab.tabId === pane.tabId && !tab.bound && tab.panes.some((item) => item.terminalId === pane.terminalId)) === true;
  }
  private acceptsProjectionOrder(projection: Projection) {
    if (!projection || typeof projection.machineId !== 'string' || typeof projection.generation !== 'string' || !Number.isSafeInteger(projection.revision) || !Array.isArray(projection.threads)) return false;
    const generation = this.projectionGenerations.get(projection.machineId);
    const current = this.projections.get(projection.machineId);
    if (!generation || generation === projection.generation) return !current || projection.revision >= current.revision;
    return !this.retiredGenerations.get(projection.machineId)?.has(projection.generation);
  }
  private rememberProjectionOrder(projection: Projection) {
    const generation = this.projectionGenerations.get(projection.machineId);
    if (generation && generation !== projection.generation) {
      let retired = this.retiredGenerations.get(projection.machineId);
      if (!retired) this.retiredGenerations.set(projection.machineId, retired = new Set());
      retired.add(generation);
      if (retired.size > 8) retired.delete(retired.values().next().value!);
    }
    this.projectionGenerations.set(projection.machineId, projection.generation);
  }
  /** Fresh binding evidence restores whatever the user had: control comes back by itself unless it was refused. */
  private reopenAfterFreshBinding(id: number, pane: VisiblePane) {
    pane.awaitingFresh = false; pane.pendingControl = false; pane.reason = undefined; pane.mode = pane.wantsControl ? 'control' : 'observe'; pane.writable = false; pane.accepted = false; pane.baseline = false; pane.resizing = false;
    this.send({ type: 'release', streamId: id, generation: pane.generation }); ++pane.generation; pane.sequence = new FrameSequence(); this.open(id);
  }
  private receiveProjection(projection: Projection) {
    const fresh = projection.connected && !!projection.freshAt;
    this.projections.set(projection.machineId, projection);
    this.projectionFresh.set(projection.machineId, fresh);
    for (const [id, pane] of this.panes) {
      if (pane.machineId !== projection.machineId) continue;
      if (!fresh) {
        pane.awaitingFresh = true; pane.pendingControl = false; pane.writable = false; pane.accepted = false; pane.baseline = false; pane.resizing = false; pane.mode = 'observe'; pane.renderer?.close(); pane.onState('Disconnected; input is disabled.', false);
        continue;
      }
      if (!this.projectionContains(pane, projection)) {
        this.send({ type: 'release', streamId: id, generation: pane.generation });
        pane.awaitingFresh = true; pane.pendingControl = false; pane.writable = false; pane.accepted = false; pane.baseline = false; pane.resizing = false; pane.mode = 'observe'; pane.renderer?.close(); pane.reason = 'Terminal binding is no longer available.'; pane.onState(pane.reason, false);
        continue;
      }
      if (pane.pendingControl) { pane.pendingControl = false; pane.awaitingFresh = false; this.open(id); continue; }
      if (pane.awaitingFresh) this.reopenAfterFreshBinding(id, pane);
    }
  }
  private send(action: TerminalAction) {
    if (this.binary?.readyState !== WebSocket.OPEN || this.metadata?.readyState !== WebSocket.OPEN) return false;
    if (this.binary.bufferedAmount > 32 * 1024) { this.disconnect('send_buffer_full'); return false; }
    this.binary.send(JSON.stringify(action)); return true;
  }
  private open(id: number, takeover = false) {
    const pane = this.panes.get(id);
    if (!pane) return;
    if (pane.mode === 'control' && !this.canAct(pane)) {
      pane.pendingControl = true;
      pane.writable = false;
      pane.onState('Waiting for fresh terminal binding.', false);
      return;
    }
    pane.pendingControl = false;
    pane.writable = false;
    pane.accepted = false; pane.baseline = false; pane.pending = 0; pane.resizing = false;
    pane.renderer?.close();
    pane.renderer = new TerminalRenderer(pane.terminal, (frame) => {
      if (this.panes.get(id) !== pane || pane.generation !== frame.generation) return;
      if (!this.send({ type: 'ack', streamId: id, generation: frame.generation, seq: frame.seq })) return;
      --pane.pending;
      if (frame.full && (!pane.resizing || frame.width === pane.cols && frame.height === pane.rows)) { pane.baseline = true; pane.resizing = false; const openedAt = this.openedAt.get(id); if (openedAt !== undefined) { time('openToBaselineMs', perfNow() - openedAt); this.openedAt.delete(id); } }
      const ready = pane.mode === 'control' && pane.accepted && pane.baseline;
      pane.writable = ready;
      if (frame.full) { trace('stream.baseline', { terminalId: pane.terminalId, width: frame.width, height: frame.height, expected: [pane.cols, pane.rows], ready }); pane.onState(ready ? 'Input control is active.' : pane.reason ?? 'Read-only', ready, typeable(pane)); }
    });
    trace('stream.open', { terminalId: pane.terminalId, mode: pane.mode, generation: pane.generation, cols: pane.cols, rows: pane.rows, takeover });
    pane.onState(pane.mode === 'control' ? 'Waiting for terminal control.' : pane.reason ?? 'Read-only', false);
    this.openedAt.set(id, perfNow());
    this.send({ type: 'open', streamId: id, generation: pane.generation, machineId: pane.machineId, ...(pane.threadId ? { threadId: pane.threadId } : { tabId: pane.tabId! }), terminalId: pane.terminalId, mode: pane.mode, cols: pane.cols, rows: pane.rows, takeover });
  }
  private connect() {
    if (this.stopped) return;
    this.instance = uuid();
    const epoch = ++this.epoch;
    const base = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
    const metadata = new WebSocket(base + '/api/ws/metadata?instance=' + this.instance);
    const binary = new WebSocket(base + '/api/ws/terminal?instance=' + this.instance);
    this.metadata = metadata; this.binary = binary; binary.binaryType = 'arraybuffer';
    const opened = () => { if (epoch !== this.epoch || metadata.readyState !== 1 || binary.readyState !== 1) return; this.connectedAt = Date.now(); this.onConnection(true); for (const [id, pane] of this.panes) { ++pane.generation; pane.sequence = new FrameSequence(); pane.attempts = 0; this.open(id); } };
    metadata.onopen = opened; binary.onopen = opened;
    metadata.onmessage = (event) => { if (epoch !== this.epoch) return; try { const record = JSON.parse(event.data); if (record.type === 'projection' && this.acceptsProjectionOrder(record.projection)) { const accepted = this.install(record.projection); if (accepted !== false) { this.rememberProjectionOrder(record.projection); this.receiveProjection(record.projection); } } } catch (error) { console.error('Projection update failed:', error instanceof Error ? error.message : error); this.disconnect('projection_failed'); } };
    binary.onmessage = (event) => {
      if (epoch !== this.epoch) return;
      try {
        if (typeof event.data === 'string') {
          const record = JSON.parse(event.data);
          const pane = this.panes.get(record.streamId);
          if (!pane || pane.generation !== record.generation) return;
          if (record.type === 'stream.opened') { pane.accepted = !!record.writable && pane.mode === 'control'; trace('stream.opened', { terminalId: pane.terminalId, writable: !!record.writable, mode: pane.mode }); if (pane.accepted) { pane.baseline = false; pane.resizing = true; this.send({ type: 'resize', streamId: record.streamId, generation: record.generation, cols: pane.cols, rows: pane.rows }); } pane.writable = pane.accepted && pane.baseline; pane.onState(pane.writable ? 'Input control is active.' : pane.reason ?? (pane.accepted ? 'Waiting for the full baseline.' : 'Read-only'), pane.writable, typeable(pane)); }
          if (record.type === 'stream.closed' || record.type === 'stream.error') {
            trace(record.type, { terminalId: pane.terminalId, reason: record.reason, mode: pane.mode });
            const reason = record.reason === 'controller_conflict' ? conflictMessage : String(record.reason).replaceAll('_', ' ');
            const lostBinding = record.reason === 'binding_invalid' || record.reason === 'machine_disconnected';
            const wasControl = pane.mode === 'control';
            const refused = controlWasRefused(record.reason);
            pane.writable = false; pane.accepted = false; pane.baseline = false; pane.renderer?.close(); pane.reason = reason; pane.onState(reason, false);
            if (lostBinding) pane.awaitingFresh = true;
            if (refused) pane.wantsControl = false;
            pane.mode = 'observe';
            if (record.type === 'stream.error' && record.reason !== 'stream_resync_required' && !refused) pane.awaitingFresh = true;
            if (record.type === 'stream.error' && wasControl) { ++pane.generation; pane.sequence = new FrameSequence(); pane.mode = pane.wantsControl ? 'control' : 'observe'; this.open(record.streamId); return; }
            if (record.reason === 'stream_resync_required' && pane.attempts++ < 2) { ++pane.generation; pane.sequence = new FrameSequence(); pane.mode = pane.wantsControl ? 'control' : 'observe'; this.open(record.streamId); }
          }
          return;
        }
        const decodeStart = perfNow();
        const frame = decodeFrame(new Uint8Array(event.data));
        count('framesIn'); count('bytesIn', event.data.byteLength); time('decodeMs', perfNow() - decodeStart);
        const typedAt = this.inputSentAt.get(frame.streamId);
        if (typedAt !== undefined) { time('inputToFrameMs', perfNow() - typedAt); this.inputSentAt.delete(frame.streamId); }
        const scrolledAt = this.scrollSentAt.get(frame.streamId);
        if (scrolledAt !== undefined) { time('scrollToFrameMs', perfNow() - scrolledAt); this.scrollSentAt.delete(frame.streamId); }
        const pane = this.panes.get(frame.streamId);
        if (!pane || pane.generation !== frame.generation) return;
        pane.sequence.accept(frame);
        ++pane.pending; gauge('unackedFrames', pane.pending);
        pane.renderer?.push(frame);
      } catch { this.disconnect('frame_failed'); }
    };
    const lost = (event?: Event) => { if (epoch === this.epoch) this.disconnect(`socket_${event?.type ?? 'closed'}`); };
    metadata.onclose = lost; metadata.onerror = lost; binary.onclose = lost; binary.onerror = lost;
  }
  private disconnect(cause = 'stopped') {
    trace('socket.disconnect', { cause, connectedForMs: this.connectedAt ? Date.now() - this.connectedAt : null, panes: this.panes.size });
    if (this.connectedAt && Date.now() - this.connectedAt >= 30_000) this.failures = 0;
    this.connectedAt = 0;
    ++this.epoch;
    this.metadata?.close(); this.binary?.close(); this.metadata = undefined; this.binary = undefined;
    for (const machineId of this.projections.keys()) this.projectionFresh.set(machineId, false);
    this.onConnection(false);
    for (const pane of this.panes.values()) { this.projectionFresh.set(pane.machineId, false); pane.renderer?.close(); pane.writable = false; pane.accepted = false; pane.baseline = false; pane.resizing = false; pane.awaitingFresh = false; pane.pendingControl = false; pane.mode = 'observe'; pane.onState('Disconnected; input was not saved.', false); }
    clearTimeout(this.reconnect);
    if (!this.stopped) this.reconnect = setTimeout(() => this.connect(), retryDelay(this.failures++));
  }
}
