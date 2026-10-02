import type { IncomingHttpHeaders } from 'node:http';

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const FORWARDING_HEADERS = ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip', 'forwarded', 'via'];

const hostnameOf = (host: string | undefined) => { try { return new URL(`http://${host}`).hostname; } catch { return undefined; } };
const isLoopbackAddress = (address: string | undefined) => !!address && (address === '::1' || address.startsWith('127.') || address.startsWith('::ffff:127.'));
const isForwarded = (headers: IncomingHttpHeaders) => FORWARDING_HEADERS.some((name) => name in headers) || Object.keys(headers).some((name) => name.startsWith('tailscale-'));
const isIpLiteral = (hostname: string) => hostname.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
const isNameControlledByNetwork = (hostname: string) => hostname.endsWith('.local') || hostname.endsWith('.ts.net');

export const isLoopbackHost = (host: string | undefined) => LOOPBACK_HOSTNAMES.has(hostnameOf(host) ?? '');

export function isLocalRequest(request: { headers: IncomingHttpHeaders; socket: { remoteAddress?: string } }) {
  return isLoopbackAddress(request.socket.remoteAddress) && isLoopbackHost(request.headers.host) && !isForwarded(request.headers);
}

export function isTrustedHost(host: string | undefined, configuredHost: string) {
  const hostname = hostnameOf(host);
  return !!host && !!hostname && (host === configuredHost || LOOPBACK_HOSTNAMES.has(hostname) || isIpLiteral(hostname) || isNameControlledByNetwork(hostname));
}
