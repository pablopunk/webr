import { afterEach, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:net';
import { openWebr, statusLines } from '../server/where';

let server: Server | undefined;
afterEach(() => { server?.close(); server = undefined; });
const listen = () => new Promise<number>((done) => { server = createServer().listen(0, '127.0.0.1', () => done((server!.address() as { port: number }).port)); });
const closedPort = async () => { const port = await listen(); await new Promise((done) => server!.close(done)); return port; };

it('reports where Webr runs', async () => {
  const port = await listen();
  expect(await statusLines(port)).toEqual([`Webr is running at http://localhost:${port}`]);
});

it('explains how to start Webr when it is down', async () => {
  const port = await closedPort();
  expect((await statusLines(port))[0]).toBe(`Webr is not running. Its address is http://localhost:${port}.`);
});

it('opens the browser only when Webr is running', async () => {
  const open = vi.fn();
  const port = await listen();
  expect(await openWebr(port, open)).toEqual([`Opening http://localhost:${port}`]);
  expect(open).toHaveBeenCalledWith(`http://localhost:${port}`);
  server!.close(); server = undefined;
  open.mockClear();
  expect((await openWebr(port, open))[0]).toContain('not running');
  expect(open).not.toHaveBeenCalled();
});
