import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const TAILSCALE_BINARIES = ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale'];
const HTTPS_PORTS = [443, 8443, 10000];

type ServeStatus = { TCP?: Record<string, unknown>; Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }> };
type TailscaleStatus = { Self?: { DNSName?: string }; CertDomains?: string[] };

const withoutTrailingDot = (name: string) => name.replace(/\.$/, '');
const portOfProxy = (proxy: string | undefined) => { try { return Number(new URL(proxy ?? '').port); } catch { return undefined; } };
const proxiesTo = (status: ServeStatus, hostPort: string, port: number) => Object.values(status.Web?.[hostPort]?.Handlers ?? {}).some((handler) => portOfProxy(handler.Proxy) === port);
const isFree = (status: ServeStatus, name: string, httpsPort: number) => !(String(httpsPort) in (status.TCP ?? {})) && !(`${name}:${httpsPort}` in (status.Web ?? {}));
const urlFor = (name: string, httpsPort: number) => `https://${name}${httpsPort === 443 ? '' : `:${httpsPort}`}`;

export function choosePort(status: ServeStatus, name: string, webrPort: number) {
  const reusable = HTTPS_PORTS.find((httpsPort) => proxiesTo(status, `${name}:${httpsPort}`, webrPort));
  return reusable !== undefined ? { port: reusable, exists: true } : { port: HTTPS_PORTS.find((httpsPort) => isFree(status, name, httpsPort)), exists: false };
}

async function tailscale(args: string[]) {
  for (const binary of TAILSCALE_BINARIES) {
    try { return (await run(binary, args, { timeout: 10_000 })).stdout; } catch { /* try the next binary */ }
  }
  throw new Error('tailscale unavailable');
}

export type TailscaleHttps = { status: 'ready'; url: string } | { status: 'https-disabled' | 'unavailable' };

export async function ensureTailscaleHttps(webrPort: number): Promise<TailscaleHttps> {
  try {
    const { Self, CertDomains } = JSON.parse(await tailscale(['status', '--json'])) as TailscaleStatus;
    const name = Self?.DNSName && withoutTrailingDot(Self.DNSName);
    if (!name) return { status: 'unavailable' };
    if (!CertDomains?.includes(name)) return { status: 'https-disabled' };
    const { port, exists } = choosePort(JSON.parse(await tailscale(['serve', 'status', '--json'])) as ServeStatus, name, webrPort);
    if (port === undefined) return { status: 'unavailable' };
    if (!exists) await tailscale(['serve', '--bg', `--https=${port}`, `http://127.0.0.1:${webrPort}`]);
    return { status: 'ready', url: urlFor(name, port) };
  } catch { return { status: 'unavailable' }; }
}
