import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_FILE } from './files';

export type PluginConfig = { port?: number; host?: string; origin?: string };

export function writePluginConfig(configDir: string, config: PluginConfig) {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, CONFIG_FILE), `${JSON.stringify(config, null, 2)}\n`);
}

export function readPluginConfig(configDir: string): PluginConfig {
  try { return JSON.parse(readFileSync(join(configDir, CONFIG_FILE), 'utf8')) as PluginConfig; } catch { return {}; }
}
