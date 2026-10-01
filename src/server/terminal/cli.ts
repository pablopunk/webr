import { spawn, type SpawnOptions } from 'node:child_process';
import { z } from 'zod';
import { NdjsonParser } from '../protocol/ndjson';
import { MAX_FRAME_BYTES } from '../../shared/frame';
import { OrderedWriter } from './writer';

const frameSchema = z.object({ type: z.literal('terminal.frame'), encoding: z.literal('ansi'), seq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), width: z.number().int().min(1).max(500), height: z.number().int().min(1).max(300), full: z.boolean(), bytes: z.string().max(Math.ceil(MAX_FRAME_BYTES / 3) * 4).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/) });
export type TerminalFrame = { seq: number; width: number; height: number; full: boolean; bytes: Uint8Array };
export type TerminalStream = { send(command: Record<string, unknown>): void; close(): void };

export function openCliStream(command: string, args: string[], options: SpawnOptions, onFrame: (frame: TerminalFrame) => void, onClose: (reason: string) => void): TerminalStream {
  const child = spawn(command, args, { ...options, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
  let closed = false;
  let first = true;
  let stderrBytes = 0;
  const writer = new OrderedWriter(child.stdin!, () => finish('writer_failed'));
  const finish = (reason: string) => {
    if (closed) return;
    closed = true; clearTimeout(timer); writer.close();
    child.stdin?.end(JSON.stringify({ type: 'terminal.release' }) + '\n');
    const kill = setTimeout(() => child.kill('SIGTERM'), 200);
    kill.unref(); child.once('exit', () => clearTimeout(kill));
    onClose(reason);
  };
  const timer = setTimeout(() => finish('terminal_timeout'), 5000);
  const parser = new NdjsonParser((record) => {
    if (z.object({ type: z.literal('terminal.closed'), reason: z.string() }).safeParse(record).success) { finish('terminal_closed'); return; }
    const value = frameSchema.parse(record);
    const bytes = Buffer.from(value.bytes, 'base64');
    if (bytes.length > MAX_FRAME_BYTES || (first && !value.full)) throw new Error('baseline_required');
    first = false; clearTimeout(timer);
    onFrame({ ...value, bytes });
  }, 400 * 1024);
  child.stdout!.on('data', (chunk: Buffer) => { try { parser.push(chunk); } catch { finish('invalid_terminal_frame'); } });
  child.stderr!.on('data', (chunk: Buffer) => { stderrBytes += chunk.length; if (stderrBytes > 16 * 1024) finish('terminal_stderr_limit'); });
  child.on('error', () => finish('terminal_unavailable'));
  child.on('exit', () => { try { parser.end(); } catch { finish('partial_terminal_frame'); } finish('terminal_exited'); });
  return { send: (command) => { if (closed) throw new Error('terminal_closed'); writer.send(command); }, close: () => finish('released') };
}
