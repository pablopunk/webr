import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { discoverSavedMachines } from '../src/server/transport/saved-machines';

const machine = (id: string, label: string, enabled = true) => ({ id, label, target: `${label}@host`, session: 'default', enabled });
async function stateWithExecutable(id: string) {
  const state = await mkdtemp(join(tmpdir(), 'webr-state-'));
  await mkdir(join(state, 'herdr', 'client', 'ssh-metadata'), { recursive: true });
  await writeFile(join(state, 'herdr', 'client', 'ssh-metadata', id + '.json'), JSON.stringify({ metadata: { executable: '/home/u/.local/bin/herdr' } }));
  return { XDG_STATE_HOME: state };
}

it('turns each reachable enabled saved machine into an approved ssh profile', async () => {
  const env = await stateWithExecutable('a1');
  const run = async (command: string, args: string[]) => command === 'herdr' ? JSON.stringify([machine('a1', 'box'), machine('b2', 'off', false)]) : JSON.stringify({ sessions: [{ name: 'default', socket_path: '/home/u/.config/herdr/herdr.sock' }] });
  expect(await discoverSavedMachines(env, run)).toMatchObject([{ id: 'a1', name: 'box', transport: 'ssh', host: 'box@host', socket: '/home/u/.config/herdr/herdr.sock', executable: '/home/u/.local/bin/herdr', automatic: true }]);
  const found: string[] = []; await discoverSavedMachines(env, run, (profile) => found.push(profile.id)); expect(found).toEqual(['a1']);
});
it('skips machines that cannot be reached and survives a missing herdr', async () => {
  const env = await stateWithExecutable('a1');
  const unreachable = async (command: string) => { if (command === 'herdr') return JSON.stringify([machine('a1', 'box')]); throw new Error('process_timeout'); };
  expect(await discoverSavedMachines(env, unreachable)).toEqual([]);
  expect(await discoverSavedMachines(env, async () => { throw new Error('process_unavailable'); })).toEqual([]);
});
