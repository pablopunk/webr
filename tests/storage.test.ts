import { expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MetadataDatabase } from '../src/server/storage/database';
import { reconcile } from '../src/server/runtime/reconcile';
import { RuntimeManager } from '../src/server/runtime/manager';
import { FakeTarget } from './fixtures/target';
import { readApprovedIcon } from '../src/server/transport/icons';

it('migrates a private WAL database repeatedly and retains UUID aliases and avatars after reopening', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hd-')); const path = join(directory, 'gateway.sqlite');
  try {
    const first = new MetadataDatabase(path); expect(first.sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
    const target = new FakeTarget(); const record = reconcile(first, target, target.state).threads[0]; first.close();
    const second = new MetadataDatabase(path);
    expect(reconcile(second, target, target.state).threads[0].id).toBe(record.id); expect(second.threadRows()[0].avatar).toBe(record.avatarIndex);
    expect(second.registerProfile('fixture', 'fixture', 'one', target.locations)).toBe(1);
    expect(second.registerProfile('fixture', 'fixture', 'one', target.locations)).toBe(1);
    expect(second.registerProfile('fixture', 'fixture', 'two', target.locations)).toBe(2); second.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
it('requires explicit adoption of a new terminal identity after cold restore and never reruns a prompt', async () => {
  const database = new MetadataDatabase(':memory:'); const target = new FakeTarget(); const manager = new RuntimeManager(database, [target]);
  try {
    manager.start(); await expect.poll(() => manager.bootstrap().threads.length).toBe(1); const id = manager.bootstrap().threads[0].id;
    target.state.panes[0].terminal_id = 'term_restored'; target.event!();
    await expect.poll(() => manager.bootstrap().threads[0].bindingState).toBe('detached');
    expect(() => manager.binding(target.id, id, 'term_restored')).toThrow('binding_invalid');
    await manager.adopt(target.id, id, ['term_restored']); expect(manager.bootstrap().threads[0].bindingState).toBe('attached'); expect(target.effects).toEqual([]);
  } finally { await manager.close(); database.close(); }
});
it('scans only fixed icon candidates within an approved target root and does not follow escaping symlinks', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hi-')); const root = join(directory, 'root'); await mkdir(root);
  try {
    await writeFile(join(directory, 'private.svg'), 'must not be returned'); await symlink(join(directory, 'private.svg'), join(root, 'icon.png'));
    expect(await readApprovedIcon(root)).toBeUndefined(); await mkdir(join(root, 'public')); await writeFile(join(root, 'public', 'favicon.ico'), Buffer.from([1, 2, 3]));
    expect((await readApprovedIcon(root))?.contentType).toBe('image/x-icon');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
