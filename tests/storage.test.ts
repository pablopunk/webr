import { expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MetadataDatabase } from '../src/server/storage/database';
import { reconcile } from '../src/server/runtime/reconcile';
import { RuntimeManager } from '../src/server/runtime/manager';
import { FakeTarget } from './fixtures/target';
import { listIconCandidates, readApprovedIcon } from '../src/server/transport/icons';

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
it('persists recovery scopes across restart while isolating servers and owners', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hr-')); const path = join(directory, 'gateway.sqlite');
  try {
    const first = new MetadataDatabase(path);
    const local = first.recoveryScope('local'); const account = first.recoveryScope('account-b'); first.close();
    expect(account).not.toBe(local);
    const restarted = new MetadataDatabase(path);
    try { expect(restarted.recoveryScope('local')).toBe(local); expect(restarted.recoveryScope('account-b')).toBe(account); }
    finally { restarted.close(); }
    const otherServer = new MetadataDatabase(':memory:');
    try { expect(otherServer.recoveryScope('local')).not.toBe(local); }
    finally { otherServer.close(); }
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
it('lists project icon candidates ordered by likelihood without leaving the approved root', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hi-')); const root = join(directory, 'root'); await mkdir(join(root, 'public'), { recursive: true });
  try {
    await writeFile(join(root, 'logo.png'), 'logo'); await writeFile(join(root, 'public', 'favicon.ico'), 'fav'); await writeFile(join(root, 'photo.png'), 'photo');
    await writeFile(join(directory, 'outside.png'), 'outside'); await symlink(join(directory, 'outside.png'), join(root, 'icon.png'));
    expect((await listIconCandidates(root)).map((candidate) => candidate.name)).toEqual(['public/favicon.ico', 'logo.png']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
it('focuses only a pane that belongs to the thread so Herdr marks finished work as seen', async () => {
  const database = new MetadataDatabase(':memory:'); const target = new FakeTarget(); const manager = new RuntimeManager(database, [target]);
  try {
    manager.start(); await expect.poll(() => manager.bootstrap().threads.length).toBe(1);
    const thread = manager.bootstrap().threads[0];
    expect(await manager.focusPane(target.id, thread.id, thread.panes[0].id)).toEqual({ focused: true, acked: false });
    expect(target.focused).toEqual([thread.panes[0].id]);
    await expect(manager.focusPane(target.id, thread.id, 'w9:p9')).rejects.toThrow('invalid_focus'); expect(target.focused).toHaveLength(1);
  } finally { await manager.close(); database.close(); }
});
it('latches unseen done on finish and keeps it through later snapshots until visit', () => {
  const database = new MetadataDatabase(':memory:'); const target = new FakeTarget();
  try {
    const idle = reconcile(database, target, target.state).threads[0];
    expect(idle.status).toBe('idle'); expect(idle.unseenDone).toBeUndefined();
    target.state.panes[0].agent_status = 'working';
    expect(reconcile(database, target, target.state).threads[0].status).toBe('working');
    expect(database.threadRows(target.id)[0].metadata.unseenDone).toBeUndefined();
    target.state.panes[0].agent_status = 'done';
    const done = reconcile(database, target, target.state).threads[0];
    expect(done.status).toBe('done'); expect(done.unseenDone).toBe(true); expect(typeof done.doneAt).toBe('string');
    const latchedAt = done.doneAt; const updatedAt = done.updatedAt;
    const again = reconcile(database, target, target.state).threads[0];
    expect(again.unseenDone).toBe(true); expect(again.doneAt).toBe(latchedAt); expect(again.updatedAt).toBe(updatedAt);
    target.state.panes[0].agent_status = 'idle';
    const read = reconcile(database, target, target.state).threads[0];
    expect(read.status).toBe('idle'); expect(read.unseenDone).toBe(true); expect(read.doneAt).toBe(latchedAt);
    target.state.panes[0].agent_status = 'working';
    const rework = reconcile(database, target, target.state).threads[0];
    expect(rework.status).toBe('working'); expect(rework.unseenDone).toBe(true); expect(rework.doneAt).toBe(latchedAt);
  } finally { database.close(); }
});
it('backfills the latch for rows already done before rollout', () => {
  const database = new MetadataDatabase(':memory:'); const target = new FakeTarget();
  try {
    reconcile(database, target, target.state);
    const row = database.threadRows(target.id)[0];
    database.saveThread({ ...row.metadata, status: 'done' }, row.anchors, row.alias);
    target.state.panes[0].agent_status = 'done';
    const latched = reconcile(database, target, target.state).threads[0];
    expect(latched.unseenDone).toBe(true); expect(typeof latched.doneAt).toBe('string');
  } finally { database.close(); }
});
it('does not latch done when a snapshot jumps from working straight to idle', () => {
  const database = new MetadataDatabase(':memory:'); const target = new FakeTarget();
  try {
    reconcile(database, target, target.state);
    target.state.panes[0].agent_status = 'working';
    reconcile(database, target, target.state);
    target.state.panes[0].agent_status = 'idle';
    const skipped = reconcile(database, target, target.state).threads[0];
    expect(skipped.status).toBe('idle'); expect(skipped.unseenDone).toBeUndefined(); expect(skipped.doneAt).toBeUndefined();
  } finally { database.close(); }
});
it('acks the done latch on visit without reordering the sidebar', async () => {
  const database = new MetadataDatabase(':memory:'); const target = new FakeTarget(); const manager = new RuntimeManager(database, [target]);
  try {
    manager.start(); await expect.poll(() => manager.bootstrap().threads.length).toBe(1);
    target.state.panes[0].agent_status = 'done'; target.event!();
    await expect.poll(() => manager.bootstrap().threads[0].unseenDone).toBe(true);
    const thread = manager.bootstrap().threads[0];
    const updatedAt = thread.updatedAt; const doneAt = thread.doneAt;
    expect(await manager.focusPane(target.id, thread.id, thread.panes[0].id)).toEqual({ focused: true, acked: true });
    expect(target.focused).toEqual([thread.panes[0].id]);
    const row = database.threadRows(target.id)[0];
    expect(row.metadata.unseenDone).toBe(false); expect(row.metadata.doneAt).toBe(doneAt); expect(row.metadata.updatedAt).toBe(updatedAt);
    target.event!();
    await expect.poll(() => manager.bootstrap().threads[0].unseenDone).toBe(false);
    expect(manager.bootstrap().threads[0].updatedAt).toBe(updatedAt);
    expect(await manager.focusPane(target.id, thread.id, thread.panes[0].id)).toEqual({ focused: true, acked: false });

    target.state.panes[0].agent_status = 'working'; target.event!();
    await expect.poll(() => manager.bootstrap().threads[0].status).toBe('working');
    target.state.panes[0].agent_status = 'done'; target.event!();
    await expect.poll(() => manager.bootstrap().threads[0].unseenDone).toBe(true);
    expect(manager.bootstrap().threads[0].doneAt).not.toBe(doneAt);
  } finally { await manager.close(); database.close(); }
});
