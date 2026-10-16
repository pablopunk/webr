import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { traceLog, traceLogPath } from '../src/server/trace-log';

const previousHome = process.env.WEBR_HOME;
afterEach(() => { if (previousHome === undefined) delete process.env.WEBR_HOME; else process.env.WEBR_HOME = previousHome; });

it('appends client trace records as JSON lines under the Webr home', async () => {
  const home = await mkdtemp(join(tmpdir(), 'webr-trace-')); process.env.WEBR_HOME = home;
  expect(traceLogPath()).toBe(join(home, 'trace.log'));
  await traceLog([{ t: '2026-10-16T14:00:00.000Z', event: 'focusout', from: 'textarea.terminal-input-capture' }], '2026-10-16T14:00:01.000Z');
  await traceLog([{ t: '2026-10-16T14:00:02.000Z', event: 'pane.state', message: 'Input control is active.' }], '2026-10-16T14:00:03.000Z');
  const lines = (await readFile(join(home, 'trace.log'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  expect(lines).toEqual([
    { t: '2026-10-16T14:00:00.000Z', event: 'focusout', from: 'textarea.terminal-input-capture', receivedAt: '2026-10-16T14:00:01.000Z' },
    { t: '2026-10-16T14:00:02.000Z', event: 'pane.state', message: 'Input control is active.', receivedAt: '2026-10-16T14:00:03.000Z' },
  ]);
  await rm(home, { recursive: true, force: true });
});
