import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const MAX_TRACE_BYTES = 20 * 1024 * 1024;
export const traceLogPath = (env: NodeJS.ProcessEnv = process.env) => join(env.WEBR_HOME ?? join(homedir(), '.webr'), 'trace.log');
let queue: Promise<unknown> = Promise.resolve();

const rotateWhenLarge = async (file: string) => {
  const size = await stat(file).then((info) => info.size, () => 0);
  if (size >= MAX_TRACE_BYTES) await rename(file, file.replace(/\.log$/, '.1.log')).catch(() => undefined);
};

/** Appends client trace records (focus moves, pane states, stream events) as JSON lines for later reading. */
export function traceLog(records: Record<string, unknown>[], receivedAt = new Date().toISOString()) {
  const file = traceLogPath();
  const lines = records.map((record) => JSON.stringify({ ...record, receivedAt }) + '\n').join('');
  queue = queue.then(() => mkdir(dirname(file), { recursive: true })).then(() => rotateWhenLarge(file)).then(() => appendFile(file, lines)).catch(() => undefined);
  return queue;
}
