import { readFile } from 'node:fs/promises';
import { MetadataDatabase } from '../src/server/storage/database';
import { RuntimeManager } from '../src/server/runtime/manager';
import { loadRegistry } from '../src/server/transport/registry';
import { HerdrTarget } from '../src/server/transport/herdr-target';
import { createHost } from '../src/server/host';
import { publicUrls } from '../src/server/public-urls';
import { isLoopbackHost } from '../src/server/auth/access';
import { serverPort } from './port';
import { builtSsr, devSsr } from './ssr';

const WILDCARD_HOSTS = ['0.0.0.0', '::'];

export async function runServer() {
  const host = process.env.HOST ?? '127.0.0.1';
  const port = serverPort();
  const tlsEnabled = !!(process.env.WEBR_TLS_CERT && process.env.WEBR_TLS_KEY);
  const origin = process.env.WEBR_ORIGIN ?? `${tlsEnabled ? 'https' : 'http'}://${WILDCARD_HOSTS.includes(host) ? 'localhost' : host}:${port}`;
  if (new URL(origin).origin !== origin || new URL(origin).username || new URL(origin).password) throw new Error('WEBR_ORIGIN must be a normalized HTTP or HTTPS origin without credentials or a path');
  if (!['http:', 'https:'].includes(new URL(origin).protocol)) throw new Error('WEBR_ORIGIN must use HTTP or HTTPS');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
  const database = new MetadataDatabase(process.env.WEBR_DATABASE ?? '.data/gateway.sqlite');
  const profiles = await loadRegistry(process.env.WEBR_TARGETS);
  const manager = new RuntimeManager(database, profiles.map((profile) => new HerdrTarget(profile)));
  const ssr = process.env.WEBR_DEV === '1' ? await devSsr(port, host) : await builtSsr();
  const tls = tlsEnabled ? { cert: await readFile(process.env.WEBR_TLS_CERT!), key: await readFile(process.env.WEBR_TLS_KEY!) } : undefined;
  const urls = publicUrls(origin, host, port);
  const app = await createHost(manager, origin, ssr.handler, tls, undefined, { publicUrls: urls });
  await app.listen({ host, port });
  manager.start();
  console.log(`Webr listening at ${origin}`);
  if (!isLoopbackHost(host) || urls.length) console.log(`Other devices connect at:\n${(urls.length ? urls : [origin]).map((url) => `  ${url}`).join('\n')}\nThey ask for access and you approve them in Webr on this computer.`);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void Promise.all([app.close(), ssr.stop()]).finally(() => { database.close(); process.exit(0); }); });
}
