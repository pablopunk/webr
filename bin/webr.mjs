#!/usr/bin/env node
import { register } from 'tsx/esm/api';

register();
const { redirectOutputToLogFile } = await import('../server/log-file.ts');
const { webrHome } = await import('../server/home.ts');
const { join } = await import('node:path');
const serverLog = process.argv[2] === 'start' ? join(webrHome(), 'logs', 'webr.log') : undefined;
redirectOutputToLogFile(process.env.WEBR_LOG_FILE ?? serverLog);
const { main } = await import('../server/cli.ts');
await main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
