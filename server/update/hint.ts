import { spawn } from 'node:child_process';
import { installedEntry } from '../entry';
import { packageInfo } from '../package-info';
import { fetchLatestVersion, isCacheFresh, readCachedLatest, writeCachedLatest } from './latest';
import { isNewerVersion } from './versions';

export const updateCheckDisabled = (env: NodeJS.ProcessEnv = process.env) => !!env.WEBR_NO_UPDATE_CHECK && env.WEBR_NO_UPDATE_CHECK !== '0';

const availableMessage = (latest: string) => `A new version of Webr is available: ${latest}. Run "webr update" to install it.`;

export async function refreshLatestVersionCache(env: NodeJS.ProcessEnv = process.env) {
  const { name, version } = packageInfo();
  const latest = await fetchLatestVersion(name).catch(() => readCachedLatest(env)?.latest ?? version);
  writeCachedLatest(latest, env);
}

const refreshInBackground = () => {
  spawn(process.execPath, [installedEntry(), 'refresh-update-cache'], { detached: true, stdio: 'ignore', windowsHide: true, env: process.env }).unref();
};

export function updateHint(env: NodeJS.ProcessEnv = process.env, refresh: () => void = refreshInBackground, now = Date.now()): string | undefined {
  if (updateCheckDisabled(env)) return undefined;
  const cached = readCachedLatest(env);
  if (!isCacheFresh(cached, now)) refresh();
  return cached && isNewerVersion(cached.latest, packageInfo().version) ? availableMessage(cached.latest) : undefined;
}
