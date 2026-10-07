import { afterEach, expect, it } from 'vitest';
import { MetadataDatabase } from '../src/server/storage/database';
import { createHost } from '../src/server/host';
import { RuntimeManager } from '../src/server/runtime/manager';
import { FakeTarget } from './fixtures/target';
import { pairPage } from '../src/server/auth/pair-page';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cleanups: (() => Promise<unknown> | void)[] = [];
const originalDist = process.env.WEBR_DIST;
afterEach(async () => { if (originalDist === undefined) delete process.env.WEBR_DIST; else process.env.WEBR_DIST = originalDist; for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

const lan = '192.168.1.5:4321';
const unpairedPhone = { host: lan };
const publicDirectory = join(process.cwd(), 'public');

async function setupHost() {
  const database = new MetadataDatabase(':memory:'); cleanups.push(() => database.close());
  const manager = new RuntimeManager(database, [new FakeTarget()]);
  const dist = await mkdtemp(join(tmpdir(), 'webr-dist-')); cleanups.push(() => rm(dist, { recursive: true, force: true }));
  await cp(publicDirectory, join(dist, 'client'), { recursive: true });
  process.env.WEBR_DIST = dist;
  const app = await createHost(manager, 'http://' + lan, (_request, response) => { response.statusCode = 200; response.end('page'); });
  cleanups.push(() => app.close());
  return app;
}
const fetchAsStranger = async (url: string) => (await setupHost()).inject({ url, headers: unpairedPhone, remoteAddress: '192.168.1.20' });

it('serves the manifest to a device without a session', async () => {
  const response = await fetchAsStranger('/manifest.webmanifest');
  expect(response.statusCode).toBe(200);
  expect(response.headers['content-type']).toContain('manifest');
  expect(response.json()).toMatchObject({ name: 'Webr', short_name: 'Webr', display: 'standalone', start_url: '/' });
});

it.each([['icon-192.png'], ['icon-512.png'], ['icon-maskable-512.png'], ['apple-touch-icon.png'], ['favicon-32.png']])('serves %s as a PNG without a session', async (file) => {
  const response = await fetchAsStranger('/' + file);
  expect(response.statusCode).toBe(200);
  expect(response.headers['content-type']).toBe('image/png');
});

it('serves the favicon as an icon without a session', async () => {
  const response = await fetchAsStranger('/favicon.ico');
  expect(response.statusCode).toBe(200);
  expect(response.headers['content-type']).toMatch(/icon/);
});

it('serves harness icons inside the app while keeping them behind the session gate', async () => {
  const local = await (await setupHost()).inject({ url: '/harness-icons/claude.png' });
  expect(local.statusCode).toBe(200);
  expect(local.headers['content-type']).toBe('image/png');
  expect((await fetchAsStranger('/harness-icons/claude.png')).statusCode).toBe(401);
});

it('still locks threads and unknown paths behind a session', async () => {
  expect((await fetchAsStranger('/api/runtime')).statusCode).toBe(401);
  expect((await fetchAsStranger('/new')).statusCode).toBe(401);
});

it('lists only files that exist for every icon the manifest declares', async () => {
  const manifest = JSON.parse(await readFile(join(publicDirectory, 'manifest.webmanifest'), 'utf8'));
  expect(manifest.icons.map((icon: { purpose: string }) => icon.purpose)).toContain('maskable');
  for (const icon of manifest.icons) await expect(readFile(join(publicDirectory, icon.src))).resolves.toBeInstanceOf(Buffer);
});

it('links the manifest and icons from the pairing page', () => {
  const html = pairPage();
  expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest">');
  expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png">');
  expect(html).toContain('viewport-fit=cover');
  expect(html).toContain('apple-mobile-web-app-capable');
});

it('links the manifest and standalone meta tags from the app layout', async () => {
  const layout = await readFile(join(process.cwd(), 'src/layouts/Base.astro'), 'utf8');
  for (const needle of ['rel="manifest" href="/manifest.webmanifest"', 'rel="apple-touch-icon"', 'viewport-fit=cover', 'apple-mobile-web-app-capable', 'apple-mobile-web-app-status-bar-style']) expect(layout).toContain(needle);
});
