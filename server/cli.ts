import { parseArgs } from 'node:util';
import { renderUnicode } from 'uqr';
import { runServer } from './run';
import { explicitPort, knownPort } from './port';
import { defaultDeps, installPlugin, pluginStatus, uninstallWebrPlugin, updatePlugin } from './plugin';
import { checkHerdr } from './herdr-check';
import { modeLines, pluginMode } from './plugin/mode';
import { openWebr, statusLines } from './where';
import { isPortOpen } from './plugin/probe';
import { packageInfo } from './package-info';
import { realUpdateEnvironment, runUpdate } from './update';
import { refreshLatestVersionCache, updateHint } from './update/hint';

const HELP = `Webr — control your Herdr agents from anywhere.

Usage
  webr [start] [options]        Run the server in this terminal
  webr plugin install [options]  Start Webr whenever the Herdr server starts, and open it
  webr plugin uninstall          Remove the Herdr plugin
  webr plugin status             Show whether the plugin is installed and Webr is running
  webr invite [--port <port>]    Print a one-time code and QR to connect a device
  webr status                    Show whether Webr is running and where
  webr open                      Open Webr in your browser
  webr update                    Install the latest version and restart the Herdr plugin

Options
  --port <port>     Port to listen on (default: first free port from 4444, then remembered)
  --host <address>  Listen on a specific address (default 0.0.0.0, every interface)
  --no-open         Don't open the browser after "plugin install"
  --origin <url>    Public URL when served through a proxy, e.g. https://mac.tailnet.ts.net
  -v, --version     Print the version
  -h, --help        Print this help

Set WEBR_NO_UPDATE_CHECK=1 to stop Webr from checking for new versions.
Localhost never needs a token. Any other device asks for access and you approve it in Webr on this computer.
`;

const options = {
  port: { type: 'string' }, host: { type: 'string' }, origin: { type: 'string' }, 'no-open': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
} as const;

function parseCommand(argv: string[]) { return parseArgs({ args: argv, options, allowPositionals: true }); }

function applyServerFlags(values: ReturnType<typeof parseCommand>['values']) {
  if (values.port) process.env.PORT = String(explicitPort(['--port', values.port], {}));
  if (values.host) process.env.HOST = values.host;
  if (values.origin) process.env.WEBR_ORIGIN = values.origin;
}

function printUpdateHint() {
  const hint = updateHint();
  if (hint) console.error(hint);
}

async function requireHerdr() {
  const status = await checkHerdr();
  if (!status.ok) throw new Error(status.problem);
  if (status.note) console.log(status.note);
}

async function invite(port: number) {
  const origin = `http://localhost:${port}`;
  const response = await fetch(`${origin}/api/pair/invites`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: '{}' }).catch(() => undefined);
  if (!response?.ok) throw new Error(`Webr is not running on port ${port}. Start Herdr, or run "webr start".`);
  const { token, urls } = await response.json() as { token: string; urls: string[] };
  if (urls[0]) console.log(`${renderUnicode(urls[0], { border: 1, invert: true })}\n${urls[0]}\n`);
  console.log(`Code: ${token}\nExpires in 5 minutes. Works once.`);
  if (!urls.length) console.log('Webr is only reachable from this computer. It was started with --host set to a local address, or no network interface was found.');
}

const pluginSettings = (values: ReturnType<typeof parseCommand>['values']) => ({
  ...(values.port ? { port: explicitPort(['--port', values.port], {}) } : {}),
  ...(values.host ? { host: values.host } : {}),
  ...(values.origin ? { origin: values.origin } : {}),
});

async function pluginCommand(action: string, values: ReturnType<typeof parseCommand>['values']) {
  const deps = defaultDeps();
  const lines = action === 'install' ? await installPlugin(pluginSettings(values), deps) : action === 'uninstall' ? await uninstallWebrPlugin(deps) : await pluginStatus(deps);
  for (const line of lines.filter(Boolean)) console.log(line);
  if (action === 'install' && !values['no-open']) await openWhenUp(knownPort(values.port ? ['--port', values.port] : []));
}

async function openWhenUp(port: number) {
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await isPortOpen({ host: '127.0.0.1', port })) return void (await openWebr(port)).forEach((line) => console.log(line));
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export async function main(argv: string[]) {
  const { values, positionals } = parseCommand(argv);
  const [command = 'start', subcommand] = positionals;
  if (values.help || command === 'help') return void console.log(HELP);
  if (values.version) { console.log(packageInfo().version); return printUpdateHint(); }
  if (command === 'start') { applyServerFlags(values); await requireHerdr(); return runServer(); }
  if (command === 'update') return void (await runUpdate(realUpdateEnvironment(() => updatePlugin(defaultDeps())))).forEach((line) => console.log(line));
  if (command === 'refresh-update-cache') return refreshLatestVersionCache().catch(() => undefined);
  if (command === 'status') return void (await statusLines(knownPort(values.port ? ['--port', values.port] : []), modeLines(pluginMode(defaultDeps().run, defaultDeps().stateDir)))).forEach((line) => console.log(line));
  if (command === 'open') return void (await openWebr(knownPort(values.port ? ['--port', values.port] : []))).forEach((line) => console.log(line));
  if (command === 'invite') return invite(knownPort(values.port ? ['--port', values.port] : []));
  if (command === 'plugin' && ['install', 'uninstall', 'status'].includes(subcommand ?? '')) return pluginCommand(subcommand!, values);
  throw new Error(`Unknown command: ${positionals.join(' ')}\n\n${HELP}`);
}
