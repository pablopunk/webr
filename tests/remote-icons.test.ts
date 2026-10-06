import { expect, it } from 'vitest';
import { listRemoteIconCandidates, readRemoteIcon, type RunRemote } from '../src/server/transport/remote-icons';

const files = ['build/Icon.icon/Assets/icon.png', './logo.png', './photo.png', 'public/favicon.ico', '../escape/favicon.ico', '/etc/favicon.ico'];
const run: RunRemote = async (_command, args) => {
  if (args[1].includes('printf')) return files.join('\n');
  return Buffer.from(`bytes:${args[4]}`).toString('base64');
};

it('lists remote icon candidates by likelihood and skips unsafe paths', async () => {
  const candidates = await listRemoteIconCandidates(run, '/home/u/app');
  expect(candidates.map((candidate) => candidate.name)).toEqual(['public/favicon.ico', 'build/Icon.icon/Assets/icon.png', 'logo.png']);
  expect((await candidates[0].load()).toString()).toBe('bytes:public/favicon.ico');
});
it('prefers the app icon directory for the default remote icon', async () => {
  const icon = await readRemoteIcon(run, '/home/u/app');
  expect(icon?.bytes.toString()).toBe('bytes:build/Icon.icon/Assets/icon.png');
  expect(icon?.contentType).toBe('image/png');
});
it('returns nothing when the remote cannot list files', async () => {
  const failing: RunRemote = async () => { throw new Error('process_failed'); };
  expect(await readRemoteIcon(failing, '/x')).toBeUndefined();
  expect(await listRemoteIconCandidates(failing, '/x')).toEqual([]);
});
