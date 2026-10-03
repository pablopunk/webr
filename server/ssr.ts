import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { distRoot } from '../src/server/dist';
import { HMR_PATH } from '../src/server/dev-hmr-proxy';

type Locals = Record<string, unknown>;
export type Ssr = { handler: (request: object, response: unknown, next: unknown, locals: Locals) => void; stop: () => Promise<void>; hmrPort?: number };

const astroLocalsSymbol = Symbol.for('astro.locals');

export async function builtSsr(): Promise<Ssr> {
  const { handler } = await import(pathToFileURL(resolve(distRoot(), 'server/entry.mjs')).href);
  return { handler, stop: async () => {} };
}

export async function devSsr(port: number, host = '127.0.0.1'): Promise<Ssr> {
  const { dev } = await import('astro');
  const astro = await dev({ server: { port: port + 2, host }, vite: { server: { allowedHosts: true, hmr: { path: HMR_PATH } } } });
  const handler: Ssr['handler'] = (request, response, _next, locals) => {
    Reflect.set(request, astroLocalsSymbol, locals);
    astro.handle(request as never, response as never);
  };
  return { handler, stop: () => astro.stop(), hmrPort: port + 2 };
}
