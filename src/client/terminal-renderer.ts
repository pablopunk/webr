import type { Terminal } from '@xterm/xterm';
import type { Frame } from '../shared/frame';
import { count, gauge, perfNow, time } from './perf';

export class TerminalRenderer {
  private frames: Frame[] = [];
  private bytes = 0;
  private writing = false;
  private closed = false;
  constructor(private terminal: Pick<Terminal, 'resize' | 'write'>, private acknowledge: (frame: Frame) => void, private budget = 512 * 1024) {}
  push(frame: Frame) {
    if (this.closed) return;
    if (this.bytes + frame.bytes.length > this.budget) throw new Error('renderer_overload');
    this.bytes += frame.bytes.length; this.frames.push(frame); gauge('rendererQueue', this.frames.length); gauge('rendererKB', this.bytes / 1024); this.flush();
  }
  close() { this.closed = true; this.frames = []; this.bytes = 0; }
  private flush() {
    if (this.closed || this.writing || !this.frames.length) return;
    this.writing = true;
    const frame = this.frames.shift()!;
    this.terminal.resize(frame.width, frame.height);
    const bytes = frame.full ? new Uint8Array(frame.bytes.length + 2) : frame.bytes;
    if (frame.full) { bytes.set([27, 99]); bytes.set(frame.bytes, 2); }
    const writeStart = perfNow();
    this.terminal.write(bytes, () => {
      if (this.closed) return;
      time('xtermWriteMs', perfNow() - writeStart); count('framesRendered');
      this.bytes -= frame.bytes.length; this.writing = false;
      this.acknowledge(frame); this.flush();
    });
  }
}
