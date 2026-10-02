import { fileURLToPath } from 'node:url';

const pnpmVersionedEntry = /^(?<globalModules>.*)[\\/]\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/](?<rest>.+)$/;

export function stableEntryPath(entry: string) {
  const match = pnpmVersionedEntry.exec(entry);
  return match?.groups ? `${match.groups.globalModules}/${match.groups.rest}` : entry;
}

export const installedEntry = () => stableEntryPath(fileURLToPath(new URL('../../bin/webr.mjs', import.meta.url)));
