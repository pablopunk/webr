import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { getMigrations } from 'better-auth/db/migration';
import { MetadataDatabase } from '../src/server/storage/database';
import { createAuth } from '../src/server/auth';
import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { boundedProcess } from '../src/server/transport/process';

it('starts the production host with coherent authenticated SSR, static assets, HTTP and two WS on one port', async () => {
  await boundedProcess('npm', ['run', 'build'], undefined, 30_000, 1024 * 1024);
  const directory = await mkdtemp(join(tmpdir(), 'hp-'));
  const listener = createServer(); await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = (listener.address() as { port: number }).port; await new Promise<void>((resolve) => listener.close(() => resolve()));
  const origin = 'http://127.0.0.1:' + port;
  const path = join(directory, 'gateway.sqlite'); const secret = 'ephemeral-production-fixture-secret-12345';
  const database = new MetadataDatabase(path); const provisioning = createAuth(database, origin, secret, true);
  await (await getMigrations(provisioning.auth.options)).runMigrations();
  const result = await provisioning.auth.api.signUpEmail({ body: { email: 'production@example.invalid', password: 'ephemeral-password-12345', name: 'Fixture' } }); database.setSetting('allowed_account', result.user.id); database.close();
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/start.ts'], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), HERDR_WEB_DATABASE: path, HERDR_WEB_ORIGIN: origin, BETTER_AUTH_SECRET: secret, HERDR_WEB_TARGETS: '', HERDR_WEB_CONNECT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', (chunk) => { output += chunk.toString(); }); child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  const sockets: WebSocket[] = [];
  try {
    await expect.poll(() => output, { timeout: 5000 }).toContain('Herdr Web listening');
    const unauthenticated = await fetch(origin + '/api/runtime'); expect(unauthenticated.status).toBe(401);
    const signIn = await fetch(origin + '/api/auth/sign-in/email', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'production@example.invalid', password: 'ephemeral-password-12345' }) }); expect(signIn.status).toBe(200);
    const cookie = signIn.headers.getSetCookie().map((header) => header.split(';')[0]).join('; ');
    const page = await fetch(origin + '/new', { headers: { cookie } }); const html = await page.text(); expect(page.status).toBe(200); expect(html).toContain('What do you want to build today?'); expect(html).toContain('herdr-app'); expect(html).not.toContain('Build machine (demo)');
    const asset = html.match(/(?:src|href)="(\/_astro\/[^"?]+\.(?:js|css))"/)?.[1]; expect(asset).toBeDefined();
    const css = await fetch(origin + asset, { headers: { cookie } }); expect(css.status).toBe(200);
    const runtime = await fetch(origin + '/api/runtime', { headers: { cookie } }); expect(await runtime.json()).toMatchObject({ machines: [], threads: [], projects: [] });
    const instance = randomUUID();
    for (const kind of ['metadata', 'terminal']) {
      const socket = new WebSocket(origin.replace('http:', 'ws:') + '/api/ws/' + kind + '?instance=' + instance, { headers: { cookie, origin } }); sockets.push(socket);
      await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    }
    expect(sockets.every((socket) => socket.readyState === 1)).toBe(true);
    expect(output).not.toContain(secret); expect(output).not.toContain('ephemeral-password');
  } finally {
    for (const socket of sockets) socket.close();
    child.kill('SIGTERM'); await new Promise<void>((resolve) => { if (child.exitCode !== null) resolve(); else child.once('exit', () => resolve()); });
    await rm(directory, { recursive: true, force: true });
  }
}, 40_000);
