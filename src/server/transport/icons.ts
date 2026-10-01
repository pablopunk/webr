import { realpath, stat, readFile } from 'node:fs/promises';
import { join, relative, isAbsolute, extname } from 'node:path';

const candidates = ['favicon.ico', 'icon.png', 'logo.png', 'public/favicon.ico', 'public/icon.png', 'public/logo.png', 'public/favicon.svg', 'static/favicon.ico', 'assets/logo.png', 'web/public/favicon.ico', 'app/public/favicon.ico', 'src/assets/logo.png'];
const contentTypes: Record<string, string> = { '.ico': 'image/x-icon', '.png': 'image/png', '.svg': 'image/svg+xml' };
export type Icon = { bytes: Buffer; contentType: string };
export async function readApprovedIcon(path: string): Promise<Icon | undefined> {
  let root: string;
  try { root = await realpath(path); } catch { return; }
  for (const candidate of candidates) {
    try {
      const file = await realpath(join(root, candidate)); const part = relative(root, file);
      if (part.startsWith('..') || isAbsolute(part)) continue;
      const info = await stat(file);
      if (!info.isFile() || info.size <= 0 || info.size > 1024 * 1024) continue;
      const bytes = await readFile(file);
      if (bytes.length > 1024 * 1024) continue;
      return { bytes, contentType: contentTypes[extname(candidate)] };
    } catch {}
  }
}
