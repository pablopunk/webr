import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { webrHome } from '../home';

const REGISTRY = 'https://registry.npmjs.org';
const REQUEST_TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type Fetch = typeof fetch;
type CachedLatest = { checkedAt: number; latest: string };

const cachePath = (env: NodeJS.ProcessEnv) => join(webrHome(env), 'update-check.json');
const registryUrl = (packageName: string) => `${REGISTRY}/${packageName.replace('/', '%2F')}/latest`;

export async function fetchLatestVersion(packageName: string, request: Fetch = fetch): Promise<string> {
  const response = await request(registryUrl(packageName), { headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' }, cache: 'no-store', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`The npm registry answered ${response.status}.`);
  const { version } = await response.json() as { version?: unknown };
  if (typeof version !== 'string') throw new Error('The npm registry sent no version.');
  return version;
}

export function readCachedLatest(env: NodeJS.ProcessEnv = process.env): CachedLatest | undefined {
  try { return JSON.parse(readFileSync(cachePath(env), 'utf8')) as CachedLatest; } catch { return undefined; }
}

export function writeCachedLatest(latest: string, env: NodeJS.ProcessEnv = process.env, now = Date.now()) {
  const path = cachePath(env);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ checkedAt: now, latest } satisfies CachedLatest));
}

export const isCacheFresh = (cached: CachedLatest | undefined, now = Date.now()): cached is CachedLatest => !!cached && now - cached.checkedAt < CACHE_TTL_MS;
