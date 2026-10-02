import { homedir } from 'node:os';
import { join } from 'node:path';
import { PLUGIN_ID } from './herdr';

export const CONFIG_FILE = 'config.json';
export const DEV_FILE = 'dev.json';
export const PID_FILE = 'webr.pid';
export const LOG_FILE = 'webr.log';

export const pluginStateDir = (env: NodeJS.ProcessEnv = process.env) => join(env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'), 'herdr', 'plugins', PLUGIN_ID);
