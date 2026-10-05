import { afterEach, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directories: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

it('stops and relaunches once the built entry changes on disk', async () => {
  const dist = mkdtempSync(join(tmpdir(), 'webr-dist-')); directories.push(dist);
  mkdirSync(join(dist, 'server'));
  const entry = join(dist, 'server/entry.mjs');
  writeFileSync(entry, 'old');
  vi.stubEnv('WEBR_DIST', dist);
  const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const { restartWhenRebuilt } = await import('../server/rebuilt-restart');
  const stop = vi.fn(async () => {});
  const relaunch = vi.fn();
  const unwatch = restartWhenRebuilt(stop, relaunch);
  utimesSync(entry, new Date(), new Date(Date.now() + 60_000));
  await vi.waitFor(() => expect(relaunch).toHaveBeenCalledOnce(), { timeout: 6000 });
  expect(stop).toHaveBeenCalledOnce();
  expect(exit).toHaveBeenCalledWith(0);
  unwatch();
}, 10_000);
