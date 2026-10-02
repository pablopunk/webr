import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { renderUnicode } from 'uqr';
import { webrHome } from './home';
import { runServer } from './run';
import { platformFor, runServiceAction, type ServiceAction } from './service';
import { serverPort } from './port';
import { defaultDeps, installPlugin, pluginStatus, uninstallWebrPlugin } from './plugin';
import { confirmOnTerminal } from './plugin/confirm';

const HELP = `Webr — control your Herdr agents from anywhere.

Usage
  webr [start] [options]        Run the server in this terminal
  webr service install [options] Run Webr in the background, starting at login
  webr service uninstall         Stop and remove the background service
  webr service status            Show whether the service is installed and running
  webr plugin install [options]  Start Webr whenever the Herdr server starts
  webr plugin uninstall          Remove the Herdr plugin
  webr plugin status             Show whether the plugin is installed and Webr is running
  webr invite [--port <port>]    Print a one-time code and QR to connect a device

Options
  --port <port>     Port to listen on (default 4321)
  --lan             Listen on every network interface so devices on your network can connect
  --host <address>  Listen on a specific address (default 127.0.0.1)
  --origin <url>    Public URL when served through a proxy, e.g. https://mac.tailnet.ts.net
  -v, --version     Print the version
  -h, --help        Print this help

Localhost never needs a token. Any other device asks for access and you approve it in Webr on this computer.
`;

const options = {
  port: { type: 'string' }, host: { type: 'string' }, origin: { type: 'string' }, lan: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
} as const;

const serverFlags = (values: ReturnType<typeof parseCommand>['values']) => [
  ...(values.port ? ['--port', serverPort(['--port', values.port], {})] : []),
  ...(values.lan ? ['--host', '0.0.0.0'] : values.host ? ['--host', values.host] : []),
  ...(values.origin ? ['--origin', values.origin] : []),
].map(String);

function parseCommand(argv: string[]) { return parseArgs({ args: argv, options, allowPositionals: true }); }

function applyServerFlags(values: ReturnType<typeof parseCommand>['values']) {
  if (values.port) process.env.PORT = String(serverPort(['--port', values.port], {}));
  if (values.lan) process.env.HOST = '0.0.0.0'; else if (values.host) process.env.HOST = values.host;
  if (values.origin) process.env.WEBR_ORIGIN = values.origin;
  process.env.WEBR_DATABASE ??= join(webrHome(), 'gateway.sqlite');
}

function readVersion() {
  return (JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as { version: string }).version;
}

async function invite(port: number) {
  const origin = `http://localhost:${port}`;
  const response = await fetch(`${origin}/api/pair/invites`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: '{}' }).catch(() => undefined);
  if (!response?.ok) throw new Error(`Webr is not running on port ${port}. Start it with "webr start" or "webr service install".`);
  const { token, urls } = await response.json() as { token: string; urls: string[] };
  if (urls[0]) console.log(`${renderUnicode(urls[0], { border: 1, invert: true })}\n${urls[0]}\n`);
  console.log(`Code: ${token}\nExpires in 5 minutes. Works once.`);
  if (!urls.length) console.log('Webr is only reachable from this computer. Restart it with --lan or --origin to connect other devices.');
}

const pluginSettings = (values: ReturnType<typeof parseCommand>['values']) => ({
  ...(values.port ? { port: serverPort(['--port', values.port], {}) } : {}),
  ...(values.lan ? { host: '0.0.0.0' } : values.host ? { host: values.host } : {}),
  ...(values.origin ? { origin: values.origin } : {}),
});

async function pluginCommand(action: string, values: ReturnType<typeof parseCommand>['values']) {
  const deps = defaultDeps(confirmOnTerminal);
  const lines = action === 'install' ? await installPlugin(pluginSettings(values), deps) : action === 'uninstall' ? uninstallWebrPlugin(deps) : await pluginStatus(deps);
  for (const line of lines.filter(Boolean)) console.log(line);
}

export async function main(argv: string[]) {
  const { values, positionals } = parseCommand(argv);
  const [command = 'start', subcommand] = positionals;
  if (values.help || command === 'help') return void console.log(HELP);
  if (values.version) return void console.log(readVersion());
  if (command === 'start') { applyServerFlags(values); return runServer(); }
  if (command === 'invite') return invite(serverPort(values.port ? ['--port', values.port] : []));
  if (command === 'service' && ['install', 'uninstall', 'status'].includes(subcommand ?? '')) {
    platformFor();
    for (const line of runServiceAction(subcommand as ServiceAction, serverFlags(values))) console.log(line);
    return;
  }
  if (command === 'plugin' && ['install', 'uninstall', 'status'].includes(subcommand ?? '')) return pluginCommand(subcommand!, values);
  throw new Error(`Unknown command: ${positionals.join(' ')}\n\n${HELP}`);
}
