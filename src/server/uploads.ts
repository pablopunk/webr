import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const UPLOAD_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const startsWith = (bytes: Buffer, signature: number[], offset = 0) => signature.every((byte, index) => bytes[offset + index] === byte);
const ascii = (text: string) => [...text].map((character) => character.charCodeAt(0));
const imageTypes: Record<string, { extension: string; matches: (bytes: Buffer) => boolean }> = {
  'image/png': { extension: 'png', matches: (bytes) => startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  'image/jpeg': { extension: 'jpg', matches: (bytes) => startsWith(bytes, [0xff, 0xd8, 0xff]) },
  'image/gif': { extension: 'gif', matches: (bytes) => startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a')) },
  'image/webp': { extension: 'webp', matches: (bytes) => startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8) },
};
export const uploadContentTypes = Object.keys(imageTypes);

export function imageExtension(contentType: string | undefined, bytes: Buffer) {
  const type = imageTypes[contentType?.split(';')[0].trim().toLowerCase() ?? ''];
  if (!type || !bytes.length || !type.matches(bytes)) throw new Error('unsupported_image');
  return type.extension;
}

export class UploadStore {
  constructor(readonly directory = resolve(process.env.WEBR_UPLOADS ?? '.data/uploads'), private lifetimeMs = UPLOAD_LIFETIME_MS) {}
  async save(contentType: string | undefined, bytes: Buffer) {
    const extension = imageExtension(contentType, bytes);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const path = join(this.directory, `image-${randomUUID()}.${extension}`);
    await writeFile(path, bytes, { mode: 0o600, flag: 'wx' });
    void this.removeExpired().catch(() => {});
    return path;
  }
  async removeExpired(now = Date.now()) {
    for (const name of await readdir(this.directory).catch(() => [] as string[])) {
      if (!/^image-[0-9a-f-]{36}\.(png|jpg|gif|webp)$/.test(name)) continue;
      const path = join(this.directory, name);
      if (now - (await stat(path)).mtimeMs > this.lifetimeMs) await rm(path, { force: true });
    }
  }
}
