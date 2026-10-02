import { join } from 'node:path';

export const PACKAGE_NAME = '@pablopunk/webr';
export const CONFIG_FILE = 'config.json';
export const DEV_FILE = 'dev.json';
export const PID_FILE = 'webr.pid';
export const LOG_FILE = 'webr.log';
export const FIRST_PORT = 4444;

const WILDCARD_HOSTS = ['0.0.0.0', '::'];

export const serverFlags = ({ port, host, origin } = {}) => [
  ...(port ? ['--port', String(port)] : []),
  ...(host ? ['--host', host] : []),
  ...(origin ? ['--origin', origin] : []),
];

export const serverEnv = ({ port, host, origin } = {}) => ({
  ...(port ? { PORT: String(port) } : {}),
  ...(host ? { HOST: host } : {}),
  ...(origin ? { WEBR_ORIGIN: origin } : {}),
});

export const probeAddress = ({ port, host } = {}, remembered) => ({
  port: port ?? remembered ?? FIRST_PORT,
  host: !host || WILDCARD_HOSTS.includes(host) ? '127.0.0.1' : host,
});

export const devTsx = (checkout) => join(checkout, 'node_modules', '.bin', 'tsx');

const checkoutPlan = (checkout, config) => ({
  action: 'start', source: 'checkout', command: devTsx(checkout), args: ['server/start.ts'], cwd: checkout, env: serverEnv(config),
});

const installedPlan = (webrPath, config) => webrPath
  ? { action: 'start', source: 'global', command: webrPath, args: ['start', ...serverFlags(config)], env: {} }
  : { action: 'start', source: 'npx', command: 'npx', args: ['-y', PACKAGE_NAME, 'start', ...serverFlags(config)], env: {} };

export function launchPlan({ config, devCheckout, webrPath, running }) {
  if (running) return { action: 'skip' };
  return devCheckout ? checkoutPlan(devCheckout, config) : installedPlan(webrPath, config);
}
