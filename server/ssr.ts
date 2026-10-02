import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { distRoot } from '../src/server/dist';

type Locals = Record<string, unknown>;
export type Ssr = { handler: (request: object, response: unknown, next: unknown, locals: Locals) => void; stop: () => Promise<void> };

const astroLocalsSymbol = Symbol.for('astro.locals');

export async function builtSsr(): Promise<Ssr> {
  const { handler } = await import(pathToFileURL(resolve(distRoot(), 'server/entry.mjs')).href);
  return { handler, stop: async () => {} };
}

export async function devSsr(port: number): Promise<Ssr> {
  const { dev } = await import('astro');
  const astro = await dev({ server: { port: port + 2, host: '127.0.0.1' }, vite: { server: { hmr: { port: port + 1 } } } });
  const handler: Ssr['handler'] = (request, response, _next, locals) => {
    Reflect.set(request, astroLocalsSymbol, locals);
    astro.handle(request as never, response as never);
  };
  return { handler, stop: () => astro.stop() };
}
