import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { webrHome } from './home';

export const FIRST_PORT = 4444;
const LAST_PORT = 65535;
const PORT_FILE = 'port';

const portArgument = (args: string[]) => { const index = args.indexOf('--port'); return index >= 0 ? args[index + 1] : args.find((arg) => arg.startsWith('--port='))?.slice('--port='.length); };
const isPort = (port: number) => Number.isInteger(port) && port >= 1 && port <= LAST_PORT;
const portFile = (home: string) => join(home, PORT_FILE);

export function explicitPort(args = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env) {
  const value = portArgument(args) ?? env.PORT;
  if (value === undefined) return undefined;
  if (!isPort(Number(value))) throw new Error('The port must be a number from 1 to 65535.');
  return Number(value);
}

export function storedPort(home = webrHome()) {
  try { const port = Number(readFileSync(portFile(home), 'utf8').trim()); return isPort(port) ? port : undefined; } catch { return undefined; }
}

const canListen = (port: number, host?: string) => new Promise<boolean>((done) => {
  const probe = createServer();
  probe.once('error', () => done(false));
  probe.listen(port, host, () => probe.close(() => done(true)));
});

const isFree = async (port: number) => (await canListen(port, '127.0.0.1')) && (await canListen(port));

async function firstFreePortFrom(start: number) {
  for (let port = start; port <= LAST_PORT; port++) if (await isFree(port)) return port;
  throw new Error('No free port found.');
}

function rememberPort(home: string, port: number) {
  mkdirSync(home, { recursive: true });
  writeFileSync(portFile(home), `${port}\n`);
}

export async function resolvePort(args = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env, home = webrHome(env)) {
  const explicit = explicitPort(args, env);
  if (explicit) return explicit;
  const stored = storedPort(home);
  if (stored) return stored;
  const claimed = await firstFreePortFrom(FIRST_PORT);
  rememberPort(home, claimed);
  return claimed;
}

export function knownPort(args = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env, home = webrHome(env)) {
  const port = explicitPort(args, env) ?? storedPort(home);
  if (!port) throw new Error('Webr has not started yet. Run "webr start", or start Herdr with the plugin installed.');
  return port;
}
