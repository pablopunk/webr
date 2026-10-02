import { homedir } from 'node:os';
import { join } from 'node:path';

export const webrHome = (env: NodeJS.ProcessEnv = process.env) => env.WEBR_HOME ?? join(homedir(), '.webr');
