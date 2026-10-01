export class NdjsonParser {
  private pending = Buffer.alloc(0);
  constructor(private onRecord: (record: unknown) => void, private limit = 1024 * 1024) {}
  push(chunk: Buffer) {
    let start = 0;
    for (let index = 0; index < chunk.length; index++) {
      if (chunk[index] !== 10) continue;
      this.append(chunk.subarray(start, index));
      const text = new TextDecoder('utf-8', { fatal: true }).decode(this.pending);
      this.pending = Buffer.alloc(0);
      if (!text.trim()) throw new Error('empty_record');
      this.onRecord(JSON.parse(text));
      start = index + 1;
    }
    this.append(chunk.subarray(start));
  }
  end() { if (this.pending.length) throw new Error('partial_record'); }
  private append(chunk: Buffer) {
    if (this.pending.length + chunk.length > this.limit) throw new Error('record_limit');
    if (chunk.length) this.pending = Buffer.concat([this.pending, chunk]);
  }
}
