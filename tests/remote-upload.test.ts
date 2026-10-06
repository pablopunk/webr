import { afterEach, expect, it } from 'vitest';
import { spawnSync, type spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, readFile, readdir, rm, stat, utimes, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { remoteUploadScript, uploadOverSsh } from '../src/server/transport/remote-upload';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });
const home = async () => { const directory = await mkdtemp(join(tmpdir(), 'webr-remote-')); directories.push(directory); return directory; };
const name = (suffix = '.pdf') => `file-${crypto.randomUUID()}${suffix}`;
const runScript = (fileName: string, input: string, HOME: string) => spawnSync('sh', ['-c', remoteUploadScript(fileName)], { input, env: { HOME, PATH: process.env.PATH }, encoding: 'utf8' });

it('writes the remote file privately and atomically, prints its absolute path and prunes week-old uploads', async () => {
  const HOME = await home(); const directory = join(HOME, '.cache', 'webr-uploads'); await mkdir(directory, { recursive: true });
  const stale = join(directory, name()); await writeFile(stale, 'old'); const week = new Date(Date.now() - 8 * 24 * 3600 * 1000); await utimes(stale, week, week);
  const keep = join(directory, 'notes.txt'); await writeFile(keep, 'keep'); await utimes(keep, week, week);
  const fileName = name(); const result = runScript(fileName, 'hello', HOME);
  expect(result.status).toBe(0); expect(result.stdout.trim()).toBe(join(directory, fileName));
  expect(await readFile(join(directory, fileName), 'utf8')).toBe('hello'); expect((await stat(join(directory, fileName))).mode & 0o777).toBe(0o600);
  expect((await readdir(directory)).sort()).toEqual([fileName, 'notes.txt'].sort());
});
it('refuses names that could escape the upload folder or the shell', () => {
  for (const bad of ['../x', 'file-1', "file-$(id)", 'notes.txt']) expect(() => remoteUploadScript(bad)).toThrow('invalid_upload_name');
});
const fakeSsh = (exitCode: number, stdout: string) => (() => {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), kill: () => true });
  child.stdin.on('finish', () => { child.stdout.write(stdout); setTimeout(() => child.emit('close', exitCode), 0); });
  return child;
}) as unknown as typeof spawn;
it('resolves the remote path printed by the ssh command', async () => {
  expect(await uploadOverSsh('pol@box', name(), Buffer.from('x'), fakeSsh(0, '/home/pol/.cache/webr-uploads/file-1.pdf\n'))).toBe('/home/pol/.cache/webr-uploads/file-1.pdf');
});
it('fails with upload_failed when ssh fails, prints no path or hangs', async () => {
  await expect(uploadOverSsh('pol@box', name(), Buffer.from('x'), fakeSsh(255, ''))).rejects.toThrow('upload_failed');
  await expect(uploadOverSsh('pol@box', name(), Buffer.from('x'), fakeSsh(0, 'relative/path\n'))).rejects.toThrow('upload_failed');
  const hanging = (() => Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), kill: () => true })) as unknown as typeof spawn;
  await expect(uploadOverSsh('pol@box', name(), Buffer.from('x'), hanging, 20)).rejects.toThrow('upload_failed');
});
it('rejects a host that could be read as an ssh option', () => { expect(() => uploadOverSsh('-oProxyCommand=x', name(), Buffer.from('x'))).toThrow('invalid_ssh_target'); });
