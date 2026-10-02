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
    const first = new MetadataDatabase(path); expect(first.sqlite.prepare('PRAGMA journal_mode').get()?.journal_mode).toBe('wal');
    const target = new FakeTarget(); const record = reconcile(first, target, target.state).threads[0]; first.close();
    const second = new MetadataDatabase(path);
    expect(reconcile(second, target, target.state).threads[0].id).toBe(record.id); expect(second.threadRows()[0].avatar).toBe(record.avatarIndex);
    expect(second.registerProfile('fixture', 'fixture', 'one', target.locations)).toBe(1);
    expect(second.registerProfile('fixture', 'fixture', 'one', target.locations)).toBe(1);
    expect(second.registerProfile('fixture', 'fixture', 'two', target.locations)).toBe(2); second.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
it('reattaches a thread to its tab after cold restore and never reruns a prompt', async () => {
  const database = new MetadataDatabase(':memory:'); const target = new FakeTarget(); const manager = new RuntimeManager(database, [target]);
  try {
    manager.start(); await expect.poll(() => manager.bootstrap().threads.length).toBe(1); const id = manager.bootstrap().threads[0].id;
    target.state.panes[0].terminal_id = 'term_restored'; target.event!();
    await expect.poll(() => manager.bootstrap().threads[0].panes[0]?.terminalId).toBe('term_restored');
    expect(manager.bootstrap().threads[0]).toMatchObject({ id, bindingState: 'attached' }); expect(() => manager.binding(target.id, id, 'term_restored')).not.toThrow(); expect(target.effects).toEqual([]);
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
it('finds a branded app favicon in a monorepo without selecting another app or escaping its root', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hi-'));
  const root = join(directory, 'maze', 'monorepo');
  const apps = join(root, 'apps');
  try {
    await mkdir(join(apps, 'report-webapp', 'public'), { recursive: true });
    await mkdir(join(apps, 'maze-webapp', 'public'), { recursive: true });
    await writeFile(join(apps, 'report-webapp', 'public', 'favicon.ico'), 'report');
    await writeFile(join(apps, 'maze-webapp', 'public', 'favicon.ico'), 'maze');
    expect((await readApprovedIcon(root))?.bytes.toString()).toBe('maze');
    await writeFile(join(directory, 'outside.ico'), 'outside');
    await symlink(join(directory, 'outside.ico'), join(root, 'favicon.ico'));
    expect((await readApprovedIcon(root))?.bytes.toString()).toBe('maze');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
it('focuses only a pane that belongs to the thread so Herdr marks finished work as seen', async () => {
  const database = new MetadataDatabase(':memory:'); const target = new FakeTarget(); const manager = new RuntimeManager(database, [target]);
  try {
    manager.start(); await expect.poll(() => manager.bootstrap().threads.length).toBe(1);
    const thread = manager.bootstrap().threads[0];
    await manager.focusPane(target.id, thread.id, thread.panes[0].id); expect(target.focused).toEqual([thread.panes[0].id]);
    await expect(manager.focusPane(target.id, thread.id, 'w9:p9')).rejects.toThrow('invalid_focus'); expect(target.focused).toHaveLength(1);
  } finally { await manager.close(); database.close(); }
});
