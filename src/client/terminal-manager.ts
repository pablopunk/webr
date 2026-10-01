import type { Terminal } from '@xterm/xterm';
import type { Projection, TerminalAction } from '../shared/runtime';
import { decodeFrame, FrameSequence } from '../shared/frame';
import { TerminalRenderer } from './terminal-renderer';

type VisiblePane = { machineId: string; threadId: string; terminalId: string; terminal: Terminal; mode: 'observe' | 'control'; generation: number; sequence: FrameSequence; renderer?: TerminalRenderer; writable: boolean; cols: number; rows: number; onState: (message: string, writable: boolean) => void; attempts: number };
export class BrowserTerminalManager {
  private metadata?: WebSocket;
  private binary?: WebSocket;
  private stopped = true;
  private epoch = 0;
  private nextId = 1;
  private panes = new Map<number, VisiblePane>();
  private reconnect?: ReturnType<typeof setTimeout>;
  private instance = '';
  constructor(private install: (projection: Projection) => void, private onConnection: (connected: boolean) => void) {}
  start() { this.stopped = false; this.connect(); }
  stop() { this.stopped = true; clearTimeout(this.reconnect); this.disconnect(); }
  mount(pane: Omit<VisiblePane, 'generation' | 'sequence' | 'writable' | 'attempts'>) {
    const id = this.nextId++;
    this.panes.set(id, { ...pane, generation: 1, sequence: new FrameSequence(), writable: false, attempts: 0 });
    this.open(id);
    return {
      close: () => { const current = this.panes.get(id); if (current) { this.send({ type: 'release', streamId: id, generation: current.generation }); current.renderer?.close(); } this.panes.delete(id); },
      input: (text: string, paste = false) => { const current = this.panes.get(id); if (current?.writable) this.send({ type: 'input', streamId: id, generation: current.generation, text, paste }); },
      control: (takeover = false) => { const current = this.panes.get(id); if (current) { this.send({ type: 'release', streamId: id, generation: current.generation }); current.mode = 'control'; ++current.generation; current.sequence = new FrameSequence(); this.open(id, takeover); } },
      observe: () => { const current = this.panes.get(id); if (current) { this.send({ type: 'release', streamId: id, generation: current.generation }); current.mode = 'observe'; ++current.generation; current.sequence = new FrameSequence(); this.open(id); } },
      resize: (cols: number, rows: number) => {
        const current = this.panes.get(id);
        if (!current || cols === current.cols && rows === current.rows) return;
        current.cols = cols; current.rows = rows;
        if (current.writable) this.send({ type: 'resize', streamId: id, generation: current.generation, cols, rows });
        else { this.send({ type: 'release', streamId: id, generation: current.generation }); ++current.generation; current.sequence = new FrameSequence(); this.open(id); }
      },
      scroll: (direction: 'up' | 'down', lines: number) => { const current = this.panes.get(id); if (current?.writable) this.send({ type: 'scroll', streamId: id, generation: current.generation, direction, lines }); },
      mouse: (action: 'down' | 'up' | 'drag' | 'move', button: 'left' | 'right' | 'middle', column: number, row: number, modifiers: number) => { const current = this.panes.get(id); if (current?.writable) this.send({ type: 'mouse', streamId: id, generation: current.generation, action, button, column, row, modifiers }); },
    };
  }
  private send(action: TerminalAction) {
    if (this.binary?.readyState !== WebSocket.OPEN || this.metadata?.readyState !== WebSocket.OPEN) return false;
    if (this.binary.bufferedAmount > 32 * 1024) { this.disconnect(); return false; }
    this.binary.send(JSON.stringify(action)); return true;
  }
  private open(id: number, takeover = false) {
    const pane = this.panes.get(id);
    if (!pane) return;
    pane.writable = false;
    pane.renderer?.close();
    pane.renderer = new TerminalRenderer(pane.terminal, (frame) => {
      if (this.panes.get(id) === pane && pane.generation === frame.generation) this.send({ type: 'ack', streamId: id, generation: frame.generation, seq: frame.seq });
    });
    pane.onState('Read-only; input modes have not been verified.', false);
    this.send({ type: 'open', streamId: id, generation: pane.generation, machineId: pane.machineId, threadId: pane.threadId, terminalId: pane.terminalId, mode: pane.mode, cols: pane.cols, rows: pane.rows, takeover });
  }
  private connect() {
    if (this.stopped) return;
    this.instance = crypto.randomUUID();
    const epoch = ++this.epoch;
    const base = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
    const metadata = new WebSocket(base + '/api/ws/metadata?instance=' + this.instance);
    const binary = new WebSocket(base + '/api/ws/terminal?instance=' + this.instance);
    this.metadata = metadata; this.binary = binary; binary.binaryType = 'arraybuffer';
    const opened = () => { if (epoch !== this.epoch || metadata.readyState !== 1 || binary.readyState !== 1) return; this.onConnection(true); for (const [id, pane] of this.panes) { ++pane.generation; pane.sequence = new FrameSequence(); pane.mode = 'observe'; pane.attempts = 0; this.open(id); } };
    metadata.onopen = opened; binary.onopen = opened;
    metadata.onmessage = (event) => { if (epoch !== this.epoch) return; try { const record = JSON.parse(event.data); if (record.type === 'projection') this.install(record.projection); } catch { this.disconnect(); } };
    binary.onmessage = (event) => {
      if (epoch !== this.epoch) return;
      try {
        if (typeof event.data === 'string') {
          const record = JSON.parse(event.data);
          const pane = this.panes.get(record.streamId);
          if (!pane || pane.generation !== record.generation) return;
          if (record.type === 'stream.opened') { pane.writable = !!record.writable; pane.onState(pane.writable ? 'Input control is active.' : 'Read-only', pane.writable); }
          if (record.type === 'stream.closed' || record.type === 'stream.error') {
            pane.writable = false; pane.onState(String(record.reason).replaceAll('_', ' '), false);
            if (record.type === 'stream.error' && pane.mode === 'control') { pane.mode = 'observe'; ++pane.generation; pane.sequence = new FrameSequence(); this.open(record.streamId); return; }
            if (record.reason === 'stream_resync_required' && pane.attempts++ < 2) { ++pane.generation; pane.sequence = new FrameSequence(); pane.mode = 'observe'; this.open(record.streamId); }
          }
          return;
        }
        const frame = decodeFrame(new Uint8Array(event.data));
        const pane = this.panes.get(frame.streamId);
        if (!pane || pane.generation !== frame.generation) return;
        pane.sequence.accept(frame);
        pane.renderer?.push(frame);
      } catch { this.disconnect(); }
    };
    const lost = () => { if (epoch === this.epoch) this.disconnect(); };
    metadata.onclose = lost; metadata.onerror = lost; binary.onclose = lost; binary.onerror = lost;
  }
  private disconnect() {
    ++this.epoch;
    this.metadata?.close(); this.binary?.close(); this.metadata = undefined; this.binary = undefined;
    this.onConnection(false);
    for (const pane of this.panes.values()) { pane.renderer?.close(); pane.writable = false; pane.mode = 'observe'; pane.onState('Disconnected; input was not saved.', false); }
    clearTimeout(this.reconnect);
    if (!this.stopped) this.reconnect = setTimeout(() => this.connect(), 1000);
  }
}
