import { createConnection } from 'node:net';
import type { PluginConfig } from './config';

const DEFAULT_PORT = 4321;
const WILDCARD_HOSTS = ['0.0.0.0', '::'];

export const probeAddress = ({ port, host }: PluginConfig) => ({
  port: port ?? DEFAULT_PORT,
  host: !host || WILDCARD_HOSTS.includes(host) ? '127.0.0.1' : host,
});

export const isPortOpen = ({ host, port }: { host: string; port: number }) => new Promise<boolean>((done) => {
  const socket = createConnection({ host, port });
  socket.once('connect', () => { socket.destroy(); done(true); });
  socket.once('error', () => done(false));
  socket.setTimeout(1000, () => { socket.destroy(); done(false); });
});
