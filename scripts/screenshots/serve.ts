import { startDemoEnvironment } from './environment';

const environment = await startDemoEnvironment();
console.log(`Demo Webr at ${environment.url}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void environment.stop().finally(() => process.exit(0)); });
