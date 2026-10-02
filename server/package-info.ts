import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type PackageInfo = { name: string; version: string };

export const packageInfo = (): PackageInfo => JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
