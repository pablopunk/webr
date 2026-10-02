import { fileURLToPath } from 'node:url';

export const distRoot = () => process.env.WEBR_DIST ?? fileURLToPath(new URL('../../dist', import.meta.url));
