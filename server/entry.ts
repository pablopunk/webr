import { fileURLToPath } from 'node:url';

export const installedEntry = () => fileURLToPath(new URL('../bin/webr.mjs', import.meta.url));
