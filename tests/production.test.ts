import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { boundedProcess } from '../src/server/transport/process';

it('starts without an account or secret with coherent SSR, static assets, HTTP and two WS on one port', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hp-')); const dist = join(process.cwd(), '.data', 'test-dist-' + randomUUID());
  await boundedProcess('mise', ['exec', '--', 'pnpm', 'exec', 'astro', 'build', '--outDir', dist], undefined, 30_000, 1024 * 1024);
  const listener = createServer(); await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = (listener.address() as { port: number }).port; await new Promise<void>((resolve) => listener.close(() => resolve()));
  const origin = 'http://127.0.0.1:' + port;
   const path = join(directory, 'gateway.sqlite');
   const registry = join(directory, 'targets.json'); await writeFile(registry, '[]');
   const child = spawn(process.execPath, ['--import', 'tsx', 'server/start.ts'], { env: { ...process.env, WEBR_DIST: dist, HOST: '127.0.0.1', PORT: String(port), WEBR_DATABASE: path, WEBR_ORIGIN: origin, BETTER_AUTH_SECRET: '', WEBR_EVIDENCE_KEY: '', WEBR_TARGETS: registry, WEBR_CONNECT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', (chunk) => { output += chunk.toString(); }); child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  const sockets: WebSocket[] = [];
  try {
    await expect.poll(() => output, { timeout: 5000 }).toContain('Webr listening');
    const anonymous = await fetch(origin + '/api/runtime'); expect(anonymous.status).toBe(200); expect(anonymous.headers.getSetCookie()).toEqual([]);
    const page = await fetch(origin + '/new'); const html = await page.text(); expect(page.status).toBe(200); expect(html).toContain('What do you want to build today?'); expect(html).toContain('webr-app'); expect(html).not.toContain('Build machine (demo)');
    const localPage = await fetch(origin + '/new', { headers: { host: 'localhost:' + port } });
    expect(localPage.status).toBe(200); expect(await localPage.text()).toContain('What do you want to build today?');
    const asset = html.match(/(?:src|href)="(\/_astro\/[^"?]+\.(?:js|css))"/)?.[1]; expect(asset).toBeDefined();
    const css = await fetch(origin + asset); expect(css.status).toBe(200);
    const runtime = await fetch(origin + '/api/runtime'); expect(await runtime.json()).toMatchObject({ machines: [], threads: [], projects: [] });
    const instance = randomUUID();
    for (const kind of ['metadata', 'terminal']) {
      const socket = new WebSocket(origin.replace('http:', 'ws:') + '/api/ws/' + kind + '?instance=' + instance, { headers: { origin } }); sockets.push(socket);
      await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    }
    expect(sockets.every((socket) => socket.readyState === 1)).toBe(true);
  } finally {
    for (const socket of sockets) socket.close();
    child.kill('SIGTERM'); await new Promise<void>((resolve) => { if (child.exitCode !== null) resolve(); else child.once('exit', () => resolve()); });
    await rm(directory, { recursive: true, force: true }); await rm(dist, { recursive: true, force: true });
  }
}, 40_000);
