import { spawn } from 'node:child_process';
import { isPortOpen } from './plugin/probe';

const localUrl = (port: number) => `http://localhost:${port}`;
const launcher = (platform = process.platform) => platform === 'darwin' ? ['open'] : platform === 'win32' ? ['cmd', '/c', 'start', ''] : ['xdg-open'];

export async function statusLines(port: number) {
  if (await isPortOpen({ host: '127.0.0.1', port })) return [`Webr is running at ${localUrl(port)}`];
  return [`Webr is not running. Its address is ${localUrl(port)}.`, 'It starts with the Herdr server once the plugin is installed ("webr plugin install"), or run "webr start".'];
}

export async function openWebr(port: number, open = openInBrowser) {
  const lines = await statusLines(port);
  if (lines.length > 1) return lines;
  open(localUrl(port));
  return [`Opening ${localUrl(port)}`];
}

function openInBrowser(url: string) {
  const [command, ...args] = launcher();
  spawn(command!, [...args, url], { detached: true, stdio: 'ignore' }).unref();
}
