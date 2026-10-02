import { readdir, realpath, stat, readFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, sep } from 'node:path';

const contentTypes: Record<string, string> = { '.ico': 'image/x-icon', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const directories = ['', 'public', 'static', 'assets', 'web/public', 'app/public', 'src/assets', 'src/app', 'frontend/public'];
export type Icon = { bytes: Buffer; contentType: string };

function withinRoot(root: string, path: string) {
  const part = relative(root, path);
  return part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part);
}

function rank(name: string) {
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

async function iconInDirectory(root: string, directory: string): Promise<Icon | undefined> {
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
      if (!info.isFile() || info.size <= 0 || info.size > 1024 * 1024) continue;
      const bytes = await readFile(file);
      if (bytes.length <= 1024 * 1024) return { bytes, contentType: contentTypes[extname(entry.name).toLowerCase()] };
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

export async function readApprovedIcon(path: string): Promise<Icon | undefined> {
  let root: string;
  try { root = await realpath(path); } catch { return; }
  for (const directory of [...directories.map((part) => join(root, part)), ...await appDirectories(root)]) {
    const icon = await iconInDirectory(root, directory);
    if (icon) return icon;
  }
}
