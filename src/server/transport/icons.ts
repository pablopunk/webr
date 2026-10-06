import { readdir, realpath, stat, readFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, sep } from 'node:path';

export const contentTypes: Record<string, string> = { '.ico': 'image/x-icon', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
export const maxBytes = 2 * 1024 * 1024;
export const directories = ['build/Icon.icon/Assets', '', 'public', 'static', 'assets', 'web', 'web/public', 'app/public', 'src/assets', 'src/app', 'frontend/public'];
export type Icon = { bytes: Buffer; contentType: string };
export type IconCandidate = { name: string; contentType: string; rank: number; load(): Promise<Buffer> };
export const maxCandidates = 12;

function withinRoot(root: string, path: string) {
  const part = relative(root, path);
  return part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part);
}

export function rank(name: string) {
  const extension = extname(name).toLowerCase();
  if (!contentTypes[extension]) return Infinity;
  const stem = name.slice(0, -extension.length).toLowerCase();
  if (stem === 'favicon') return 0;
  if (stem.startsWith('favicon-')) return 1;
  if (stem.startsWith('apple-touch-icon')) return 2;
  if (stem === 'icon' || stem === 'app-icon') return 3;
  if (stem.startsWith('icon-') || stem === 'logo' || stem === 'brand' || stem === 'mark') return 4;
  if (stem.startsWith('logo-') || stem.startsWith('brand-')) return 5;
  return Infinity;
}

async function* iconsInDirectory(root: string, directory: string): AsyncGenerator<IconCandidate & Icon> {
  let actual: string;
  try { actual = await realpath(directory); } catch { return; }
  if (!withinRoot(root, actual)) return;
  let entries;
  try { entries = await readdir(actual, { withFileTypes: true }); } catch { return; }
  entries = entries
    .filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && Number.isFinite(rank(entry.name)))
    .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
  for (const entry of entries) {
    try {
      const file = await realpath(join(actual, entry.name));
      if (!withinRoot(root, file)) continue;
      const info = await stat(file);
      if (!info.isFile() || info.size <= 0 || info.size > maxBytes) continue;
      const bytes = await readFile(file);
      if (bytes.length <= maxBytes) yield { bytes, contentType: contentTypes[extname(entry.name).toLowerCase()], name: relative(root, file), rank: rank(entry.name), load: async () => bytes };
    } catch {}
  }
}

async function appDirectories(root: string) {
  let apps: string;
  try { apps = await realpath(join(root, 'apps')); } catch { return []; }
  if (!withinRoot(root, apps)) return [];
  const brand = (basename(root) === 'monorepo' ? basename(dirname(root)) : basename(root)).toLowerCase();
  let entries;
  try { entries = (await readdir(apps, { withFileTypes: true })).filter((entry) => entry.isDirectory()); } catch { return []; }
  return entries.sort((a, b) => Number(!a.name.toLowerCase().includes(brand)) - Number(!b.name.toLowerCase().includes(brand)) || a.name.localeCompare(b.name))
    .slice(0, 32).flatMap((entry) => ['public', 'static', 'assets', 'src/assets', 'src/app'].map((part) => join(apps, entry.name, part)));
}

async function sourceDirectories(root: string) {
  try {
    return (await readdir(join(root, 'src'), { withFileTypes: true })).filter((entry) => entry.isDirectory())
      .map((entry) => entry.name).sort().slice(0, 8).map((name) => join(root, 'src', name, 'public'));
  } catch { return []; }
}

async function searchDirectories(root: string) {
  return [...directories.map((part) => join(root, part)), ...await sourceDirectories(root), ...await appDirectories(root)];
}

export async function readApprovedIcon(path: string): Promise<Icon | undefined> {
  let root: string;
  try { root = await realpath(path); } catch { return; }
  for (const directory of await searchDirectories(root)) {
    for await (const icon of iconsInDirectory(root, directory)) return icon;
  }
}

export async function listIconCandidates(path: string): Promise<IconCandidate[]> {
  let root: string;
  try { root = await realpath(path); } catch { return []; }
  const seen = new Set<string>(); const found: IconCandidate[] = [];
  for (const directory of await searchDirectories(root)) {
    for await (const icon of iconsInDirectory(root, directory)) {
      if (seen.has(icon.name)) continue;
      seen.add(icon.name); found.push({ name: icon.name, contentType: icon.contentType, rank: icon.rank, load: icon.load });
    }
  }
  return found.sort((a, b) => a.rank - b.rank).slice(0, maxCandidates);
}
