import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { explicitPort, FIRST_PORT, knownPort, resolvePort, storedPort } from '../server/port';

const homes: string[] = [];
const servers: Server[] = [];
const newHome = () => { const home = mkdtempSync(join(tmpdir(), 'webr-port-')); homes.push(home); return home; };
const occupy = (port: number) => new Promise<boolean>((done) => { const server = createServer().once('error', () => done(false)).listen(port, () => { servers.push(server); done(true); }); });
afterEach(() => { servers.splice(0).forEach((server) => server.close()); homes.splice(0).forEach((home) => rmSync(home, { recursive: true, force: true })); });

it('reads an explicit port from --port first, then PORT', () => {
  expect(explicitPort(['--port', '4400'], { PORT: '5000' })).toBe(4400);
  expect(explicitPort(['--port=4401'], {})).toBe(4401);
  expect(explicitPort([], { PORT: '5000' })).toBe(5000);
  expect(explicitPort([], {})).toBeUndefined();
  expect(() => explicitPort(['--port', 'abc'], {})).toThrow('The port must be a number');
});

it('claims a free port from 4444 up and remembers it', async () => {
  const home = newHome();
  const port = await resolvePort([], {}, home);
  expect(port).toBeGreaterThanOrEqual(FIRST_PORT);
  expect(readFileSync(join(home, 'port'), 'utf8')).toBe(`${port}\n`);
  expect(storedPort(home)).toBe(port);
});

it('keeps the remembered port even when something else holds it later', async () => {
  const home = newHome();
  const port = await resolvePort([], {}, home);
  await occupy(port);
  expect(await resolvePort([], {}, home)).toBe(port);
});

it('moves up past a taken port', async () => {
  const taken = await occupy(FIRST_PORT);
  const port = await resolvePort([], {}, newHome());
  expect(port).toBeGreaterThanOrEqual(taken ? FIRST_PORT + 1 : FIRST_PORT);
});

it('does not remember an explicit port', async () => {
  const home = newHome();
  expect(await resolvePort(['--port', '4999'], {}, home)).toBe(4999);
  expect(storedPort(home)).toBeUndefined();
});

it('ignores a corrupt port file', async () => {
  const home = newHome();
  writeFileSync(join(home, 'port'), 'nonsense');
  expect(storedPort(home)).toBeUndefined();
  expect(await resolvePort([], {}, home)).toBeGreaterThanOrEqual(FIRST_PORT);
});

it('knownPort finds the remembered port and fails before the first start', async () => {
  const home = newHome();
  expect(() => knownPort([], {}, home)).toThrow('has not started yet');
  const port = await resolvePort([], {}, home);
  expect(knownPort([], {}, home)).toBe(port);
  expect(knownPort(['--port', '5001'], {}, home)).toBe(5001);
});
