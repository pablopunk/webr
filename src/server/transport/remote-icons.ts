import { basename, dirname, extname } from 'node:path';
import { contentTypes, maxBytes, maxCandidates, rank, type Icon, type IconCandidate } from './icons';

export type RunRemote = (command: string, args: string[], timeoutMs: number, outputLimit: number) => Promise<string>;
const listTimeoutMs = 10_000;
const listLimit = 256 * 1024;
const readTimeoutMs = 20_000;
const readLimit = Math.ceil(maxBytes * 4 / 3) + 1024;
const maxListed = 2000;
const safeRelativePath = /^(?!\/)(?!.*(^|\/)\.\.(\/|$))[^\0\r\n]+$/;

const listScript = [
  'cd "$1" 2>/dev/null || exit 0',
  'for d in build/Icon.icon/Assets . public static assets web web/public app/public src/assets src/app frontend/public src/*/public apps/*/public apps/*/static apps/*/assets apps/*/src/assets apps/*/src/app; do',
  '  [ -d "$d" ] && [ ! -L "$d" ] || continue',
  '  for f in "$d"/*; do [ -f "$f" ] && [ ! -L "$f" ] && printf \'%s\\n\' "$f"; done',
  'done',
].join('\n');
const readScript = 'cd "$1" && [ -f "$2" ] && [ ! -L "$2" ] && head -c ' + (maxBytes + 1) + ' "$2" | base64';

type Listed = { name: string; directoryOrder: number; rank: number };

async function listIconFiles(run: RunRemote, root: string): Promise<Listed[]> {
  const lines = (await run('/bin/sh', ['-c', listScript, 'sh', root], listTimeoutMs, listLimit).catch(() => '')).split('\n').slice(0, maxListed);
  const directoryOrder = new Map<string, number>();
  const listed: Listed[] = [];
  for (const line of lines) {
    const name = line.startsWith('./') ? line.slice(2) : line;
    if (!safeRelativePath.test(name) || !Number.isFinite(rank(basename(name)))) continue;
    const directory = dirname(name);
    if (!directoryOrder.has(directory)) directoryOrder.set(directory, directoryOrder.size);
    listed.push({ name, directoryOrder: directoryOrder.get(directory)!, rank: rank(basename(name)) });
  }
  return listed;
}

async function readIconFile(run: RunRemote, root: string, name: string): Promise<Buffer | undefined> {
  const bytes = Buffer.from(await run('/bin/sh', ['-c', readScript, 'sh', root, name], readTimeoutMs, readLimit).catch(() => ''), 'base64');
  return bytes.length > 0 && bytes.length <= maxBytes ? bytes : undefined;
}

const contentTypeOf = (name: string) => contentTypes[extname(name).toLowerCase()];

export async function readRemoteIcon(run: RunRemote, root: string): Promise<Icon | undefined> {
  const inPreferredOrder = (await listIconFiles(run, root)).sort((a, b) => a.directoryOrder - b.directoryOrder || a.rank - b.rank || a.name.localeCompare(b.name));
  for (const file of inPreferredOrder.slice(0, maxCandidates)) {
    const bytes = await readIconFile(run, root, file.name);
    if (bytes) return { bytes, contentType: contentTypeOf(file.name) };
  }
}

export async function listRemoteIconCandidates(run: RunRemote, root: string): Promise<IconCandidate[]> {
  const byLikelihood = (await listIconFiles(run, root)).sort((a, b) => a.rank - b.rank || a.directoryOrder - b.directoryOrder || a.name.localeCompare(b.name));
  return byLikelihood.slice(0, maxCandidates).map((file) => ({
    name: file.name, contentType: contentTypeOf(file.name), rank: file.rank,
    load: async () => { const bytes = await readIconFile(run, root, file.name); if (!bytes) throw new Error('icon_unavailable'); return bytes; },
  }));
}
