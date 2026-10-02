import { afterEach, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RotatingLog, redirectOutputToLogFile } from '../server/log-file';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const logPath = () => { const directory = mkdtempSync(join(tmpdir(), 'webr-log-')); directories.push(directory); return join(directory, 'logs', 'webr.log'); };
const read = (path: string) => readFileSync(path, 'utf8');

it('appends to the log and creates its directory', () => {
  const path = logPath();
  const log = new RotatingLog(path);
  log.write('one\n'); log.write('two\n');
  expect(read(path)).toBe('one\ntwo\n');
});

it('rotates when the file would grow past its limit and keeps a fixed number of backups', () => {
  const path = logPath();
  const log = new RotatingLog(path, { maxBytes: 10, keep: 2 });
  for (const line of ['aaaaaa\n', 'bbbbbb\n', 'cccccc\n', 'dddddd\n']) log.write(line);
  expect(read(path)).toBe('dddddd\n');
  expect(read(`${path}.1`)).toBe('cccccc\n');
  expect(read(`${path}.2`)).toBe('bbbbbb\n');
  expect(existsSync(`${path}.3`)).toBe(false);
  expect(readdirSync(join(path, '..')).sort()).toEqual(['webr.log', 'webr.log.1', 'webr.log.2']);
});

it('counts a log left by a previous run towards the limit', () => {
  const path = logPath();
  new RotatingLog(path);
  writeFileSync(path, 'old run\n');
  new RotatingLog(path, { maxBytes: 12 }).write('new run\n');
  expect(read(`${path}.1`)).toBe('old run\n');
  expect(read(path)).toBe('new run\n');
});

it('never rotates an empty file even when one line exceeds the limit', () => {
  const path = logPath();
  new RotatingLog(path, { maxBytes: 3 }).write('a long single line\n');
  expect(read(path)).toBe('a long single line\n');
  expect(existsSync(`${path}.1`)).toBe(false);
});

it('moves stdout, stderr and crashes into the log when a log file is configured', () => {
  const path = logPath();
  const out = { write: vi.fn((..._: unknown[]) => true) };
  const err = { write: vi.fn((..._: unknown[]) => true) };
  const handlers: Record<string, (error: unknown) => void> = {};
  const exit = vi.fn() as never;
  const originalOut = out.write; const originalErr = err.write;
  redirectOutputToLogFile(path, [out, err], { on: ((event: string, handler: (error: unknown) => void) => { handlers[event] = handler; }) as never, exit });
  expect(out.write).not.toBe(originalOut); expect(err.write).not.toBe(originalErr);
  const callback = vi.fn();
  out.write('hello\n', 'utf8', callback); err.write('oops\n');
  expect(callback).toHaveBeenCalledOnce();
  handlers.uncaughtException(new Error('boom'));
  expect(read(path)).toMatch(/^hello\noops\nError: boom\n\s+at /);
  expect(exit).toHaveBeenCalledWith(1);
});

it('leaves the streams alone without a log file', () => {
  const stream = { write: vi.fn((..._: unknown[]) => true) }; const original = stream.write;
  redirectOutputToLogFile(undefined, [stream], { on: vi.fn() as never, exit: vi.fn() as never });
  expect(stream.write).toBe(original);
});

it('keeps writing when the log cannot be written', () => {
  const path = logPath();
  const stream = { write: vi.fn((..._: unknown[]) => true) };
  redirectOutputToLogFile(path, [stream], { on: vi.fn() as never, exit: vi.fn() as never });
  rmSync(join(path, '..'), { recursive: true });
  writeFileSync(join(path, '..', '..', 'blocker'), '');
  expect(() => stream.write('still alive\n')).not.toThrow();
});

it('sends everything the real CLI prints to WEBR_LOG_FILE', () => {
  const path = logPath();
  const result = spawnSync(process.execPath, ['bin/webr.mjs', '--version'], { env: { ...process.env, WEBR_LOG_FILE: path, WEBR_NO_UPDATE_CHECK: '1' }, encoding: 'utf8' });
  expect(result.stdout).toBe('');
  expect(read(path)).toMatch(/^\d+\.\d+\.\d+\n/);
});
