#!/usr/bin/env node
import { register } from 'tsx/esm/api';

register();
const { main } = await import('../server/cli.ts');
await main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
