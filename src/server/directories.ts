import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const MAX_SUGGESTIONS = 12;

export const expandHome = (path: string) => path === '~' ? homedir() : path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;

const splitAtLastSlash = (prefix: string) => ({ parent: prefix.slice(0, prefix.lastIndexOf('/') + 1), partial: prefix.slice(prefix.lastIndexOf('/') + 1) });
const startsWithPartial = (partial: string) => (name: string) => name.toLowerCase().startsWith(partial.toLowerCase()) && (partial.startsWith('.') || !name.startsWith('.'));

export async function suggestDirectories(prefix: string): Promise<string[]> {
  if (!prefix.startsWith('/') && !prefix.startsWith('~')) return [];
  const { parent, partial } = splitAtLastSlash(prefix.includes('/') ? prefix : `${prefix}/`);
  const entries = await readdir(expandHome(parent), { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() && startsWithPartial(partial)(entry.name))
    .map((entry) => `${parent}${entry.name}/`)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, MAX_SUGGESTIONS);
}
