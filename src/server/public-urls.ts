import { networkInterfaces } from 'node:os';
import { isLoopbackHost } from './auth/access';

const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '[::]']);
type Interfaces = ReturnType<typeof networkInterfaces>;

const VIRTUAL_INTERFACE = /^(bridge|vmnet|docker|br-|veth|vboxnet|virbr|vethernet)/i;

const lanAddresses = (interfaces: Interfaces) => Object.entries(interfaces).filter(([name]) => !VIRTUAL_INTERFACE.test(name)).flatMap(([, list]) => list ?? []).filter((entry) => entry.family === 'IPv4' && !entry.internal).map((entry) => entry.address);

export function publicUrls(origin: string, host: string, port: number, interfaces: Interfaces = networkInterfaces(), tailscaleHost?: string) {
  const { protocol, host: originHost } = new URL(origin);
  const reachable = WILDCARD_HOSTS.has(host) ? lanAddresses(interfaces) : isLoopbackHost(host) ? [] : [host];
  const named = tailscaleHost && WILDCARD_HOSTS.has(host) ? [tailscaleHost] : [];
  const urls = [...named, ...reachable].map((address) => `${protocol}//${address}:${port}`);
  return [...new Set([...(isLoopbackHost(originHost) ? [] : [origin]), ...urls])];
}
