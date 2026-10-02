import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { suggestDirectories } from '../src/server/directories';

it('lists matching directories only, hides dotfolders unless asked and ignores non-paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webr-dirs-'));
  await Promise.all(['src', 'Srv', 'other', '.secret'].map((name) => mkdir(join(root, name))));
  expect(await suggestDirectories(`${root}/s`)).toEqual([`${root}/src/`, `${root}/Srv/`].sort((a, b) => a.localeCompare(b)));
  expect(await suggestDirectories(`${root}/`)).not.toContain(`${root}/.secret/`);
  expect(await suggestDirectories(`${root}/.`)).toEqual([`${root}/.secret/`]);
  expect(await suggestDirectories('relative')).toEqual([]);
  expect(await suggestDirectories('/definitely/not/here/x')).toEqual([]);
});
