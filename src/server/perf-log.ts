import { appendFile, mkdir } from 'node:fs/promises';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const perfLogEnabled = process.env.WEBR_DEV === '1';
const file = process.env.WEBR_PERF_LOG ?? '.data/perf.jsonl';
const MAX_LOG_BYTES = 5 * 1024 * 1024;
let bytesWritten = 0;
let ready: Promise<unknown> | undefined;

function startWithAnEmptyLog() {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, '');
}
if (perfLogEnabled) startWithAnEmptyLog();

export function perfLog(source: 'client' | 'server', record: Record<string, unknown>) {
  if (!perfLogEnabled || bytesWritten >= MAX_LOG_BYTES) return;
  ready ??= mkdir(dirname(file), { recursive: true });
  const line = JSON.stringify({ ...record, at: new Date().toISOString(), source }) + '\n';
  bytesWritten += line.length;
  void ready.then(() => appendFile(file, line)).catch(() => undefined);
}
