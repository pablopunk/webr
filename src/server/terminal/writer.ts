import type { Writable } from 'node:stream';

export class OrderedWriter {
  private queue: Buffer[] = [];
  private bytes = 0;
  private writing = false;
  private closed = false;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private sink: Writable, private fail: () => void, private budget = 32 * 1024, private deadline = 2000) {}
  send(command: Record<string, unknown>) {
    if (this.closed) throw new Error('writer_closed');
    const bytes = Buffer.from(JSON.stringify(command) + '\n');
    if (this.bytes + bytes.length > this.budget) { this.close(); this.fail(); throw new Error('input_overload'); }
    this.queue.push(bytes); this.bytes += bytes.length; this.flush();
  }
  close() { this.closed = true; this.queue = []; this.bytes = 0; clearTimeout(this.timer); }
  private flush() {
    if (this.writing || this.closed || !this.queue.length) return;
    this.writing = true;
    const next = this.queue.shift()!;
    this.timer = setTimeout(() => { this.close(); this.fail(); }, this.deadline);
    this.sink.write(next, (error?: Error | null) => {
      clearTimeout(this.timer);
      this.writing = false;
      if (this.closed) return;
      this.bytes -= next.length;
      if (error) { this.close(); this.fail(); return; }
      this.flush();
    });
  }
}

export function encodeUserInput(text: string, paste: boolean): string {
  if (Buffer.byteLength(text) > 8192 || text.includes('\x1b[200~') || text.includes('\x1b[201~') || text.includes('\0')) throw new Error('invalid_input');
  if (!paste) return text;
  if (/[\x00-\x08\x0b-\x1f\x7f]/.test(text)) throw new Error('invalid_paste');
  return '\x1b[200~' + text + '\x1b[201~';
}
