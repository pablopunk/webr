import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

const MAX_BYTES = 5 * 1024 * 1024;
const KEPT_BACKUPS = 3;

type Chunk = string | Uint8Array;
type OutputStream = { write: (chunk: Chunk, ...rest: never[]) => boolean };
type LogOptions = { maxBytes?: number; keep?: number };

const sizeOf = (path: string) => existsSync(path) ? statSync(path).size : 0;
const backupPath = (path: string, index: number) => `${path}.${index}`;

export class RotatingLog {
  private size: number;
  private readonly maxBytes: number;
  private readonly keep: number;

  constructor(private readonly path: string, { maxBytes = MAX_BYTES, keep = KEPT_BACKUPS }: LogOptions = {}) {
    this.maxBytes = maxBytes;
    this.keep = keep;
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.size = sizeOf(path);
  }

  write(chunk: Chunk) {
    const length = Buffer.byteLength(chunk);
    if (this.size > 0 && this.size + length > this.maxBytes) this.rotate();
    appendFileSync(this.path, chunk, { mode: 0o600 });
    this.size += length;
  }

  private rotate() {
    rmSync(backupPath(this.path, this.keep), { force: true });
    for (let index = this.keep - 1; index >= 1; index--) if (existsSync(backupPath(this.path, index))) renameSync(backupPath(this.path, index), backupPath(this.path, index + 1));
    renameSync(this.path, backupPath(this.path, 1));
    this.size = 0;
  }
}

export function redirectOutputToLogFile(path: string | undefined = process.env.WEBR_LOG_FILE, streams: OutputStream[] = [process.stdout, process.stderr], processEvents: Pick<NodeJS.Process, 'on' | 'exit'> = process) {
  if (!path) return;
  const log = new RotatingLog(path);
  const append = (chunk: Chunk) => { try { log.write(chunk); } catch { return; } };
  for (const stream of streams) stream.write = ((chunk: Chunk, ...rest: unknown[]) => {
    append(chunk);
    const done = rest.find((argument) => typeof argument === 'function') as (() => void) | undefined;
    done?.();
    return true;
  }) as OutputStream['write'];
  processEvents.on('uncaughtException', (error) => { append(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`); processEvents.exit(1); });
}
