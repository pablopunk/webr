import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const MAX_SUGGESTIONS = 12;

export const expandHome = (path: string) => path === '~' ? homedir() : path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;

const splitAtLastSlash = (prefix: string) => ({ parent: prefix.slice(0, prefix.lastIndexOf('/') + 1), partial: prefix.slice(prefix.lastIndexOf('/') + 1) });
const startsWithPartial = (partial: string) => (name: string) => name.toLowerCase().startsWith(partial.toLowerCase()) && (partial.startsWith('.') || !name.startsWith('.'));

export type DirectoryLister = (parent: string) => Promise<string[]>;

export const listLocalDirectories: DirectoryLister = async (parent) => {
  const entries = await readdir(expandHome(parent), { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
};

export async function suggestDirectories(prefix: string, listDirectories: DirectoryLister = listLocalDirectories): Promise<string[]> {
  if (!prefix.startsWith('/') && !prefix.startsWith('~')) return [];
  const { parent, partial } = splitAtLastSlash(prefix.includes('/') ? prefix : `${prefix}/`);
  const names = await listDirectories(parent);
  return names
    .filter(startsWithPartial(partial))
    .map((name) => `${parent}${name}/`)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, MAX_SUGGESTIONS);
}
