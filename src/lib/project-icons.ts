import { homedir } from 'node:os';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { projects, type Project } from './models';

const maxBytes = 1_000_000;
const cacheForMs = 60_000;
const contentTypes: Record<string, string> = {
  '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
};

type ProjectIcon = { bytes: Uint8Array<ArrayBuffer>; contentType: string };
const cache = new Map<string, { until: number; icon: Promise<ProjectIcon | undefined> }>();

function unavailable(error: unknown): boolean {
  return ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '');
}

function rank(name: string, generic: boolean): number {
  const base = name.slice(0, -extname(name).length).toLowerCase();
  const extension = extname(name).toLowerCase();
  if (!contentTypes[extension]) return Infinity;
  if (generic) return extension === '.png' ? 0 : Infinity;
  if (base === 'favicon') return 0;
  if (base.startsWith('favicon-')) return 1;
  if (base.startsWith('apple-touch-icon')) return 2;
  if (base === 'icon' || base === 'app-icon') return 3;
  if (base.startsWith('icon-') || base === 'logo' || base === 'brand' || base === 'mark') return 4;
  if (base.startsWith('logo-') || base.startsWith('brand-')) return 5;
  return Infinity;
}

function withinRoot(root: string, path: string): boolean {
  const part = relative(root, path);
  return part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part);
}

function squarePng(bytes: Uint8Array): boolean {
  if (bytes.length < 24 || bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71) return false;
  const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = size.getUint32(16);
  const height = size.getUint32(20);
  return width >= 16 && width <= 512 && height >= 16 && height <= 512 && width / height >= 0.8 && width / height <= 1.25;
}

async function iconInDirectory(root: string, directory: string, generic = false): Promise<ProjectIcon | undefined> {
  try {
    const actualDirectory = await realpath(directory);
    if (!withinRoot(root, actualDirectory)) return;
    const entries = (await readdir(actualDirectory, { withFileTypes: true }))
      .filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && Number.isFinite(rank(entry.name, generic)))
      .sort((a, b) => rank(a.name, generic) - rank(b.name, generic) || a.name.localeCompare(b.name))
      .slice(0, generic ? 12 : undefined);
    for (const entry of entries) {
      try {
        const path = await realpath(join(actualDirectory, entry.name));
        if (!withinRoot(root, path)) continue;
        const info = await stat(path);
        if (!info.isFile() || info.size === 0 || info.size > maxBytes) continue;
        const bytes = new Uint8Array(await readFile(path));
        if (generic && !squarePng(bytes)) continue;
        return { bytes, contentType: contentTypes[extname(entry.name).toLowerCase()] };
      } catch (error) {
        if (!unavailable(error)) throw error;
      }
    }
  } catch (error) {
    if (!unavailable(error)) throw error;
  }
}

async function childDirectories(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().slice(0, 8);
  } catch (error) {
    if (!unavailable(error)) throw error;
    return [];
  }
}

async function discover(project: Project): Promise<ProjectIcon | undefined> {
  const directory = project.path.startsWith('~/') ? join(homedir(), project.path.slice(2)) : resolve(project.path);
  let root: string;
  try { root = await realpath(directory); } catch (error) {
    if (unavailable(error)) return;
    throw error;
  }

  let apps = [] as string[];
  try {
    const appsDirectory = await realpath(join(root, 'apps'));
    if (withinRoot(root, appsDirectory)) {
      apps = (await readdir(appsDirectory, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory()).map((entry) => entry.name)
        .sort((a, b) => Number(!a.includes(project.id)) - Number(!b.includes(project.id)) || a.localeCompare(b))
        .slice(0, 8);
    }
  } catch (error) {
    if (!unavailable(error)) throw error;
  }
  const sources = await childDirectories(join(root, 'src'));
  const directories = [
    ...['', 'public', 'static', 'assets', 'web', 'web/public', 'app', 'app/public', 'src/assets', 'src/app', 'frontend/public'].map((path) => join(root, path)),
    ...sources.map((source) => join(root, 'src', source, 'public')),
    ...apps.flatMap((app) => ['public', 'src/assets', 'assets'].map((path) => join(root, 'apps', app, path))),
  ];
  for (const generic of [false, true]) {
    for (const directory of directories) {
      const icon = await iconInDirectory(root, directory, generic);
      if (icon) return icon;
    }
  }
}

export function findProjectIcon(project: Project): Promise<ProjectIcon | undefined> {
  const cached = cache.get(project.id);
  if (cached && cached.until > Date.now()) return cached.icon;
  const icon = discover(project).catch((error) => {
    cache.delete(project.id);
    throw error;
  });
  cache.set(project.id, { until: Date.now() + cacheForMs, icon });
  return icon;
}

export async function projectsWithIcons(): Promise<Project[]> {
  return Promise.all(projects.map(async (project) => ({
    ...project, iconUrl: await findProjectIcon(project) ? `/api/projects/${encodeURIComponent(project.id)}/icon` : undefined,
  })));
}
