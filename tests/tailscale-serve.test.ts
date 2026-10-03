import { expect, it } from 'vitest';
import { choosePort } from '../src/server/tailscale-serve';

const name = 'm4pro.pangolin-frog.ts.net';
const serving = (port: number, target: number) => ({ TCP: { [port]: { HTTPS: true } }, Web: { [`${name}:${port}`]: { Handlers: { '/': { Proxy: `http://127.0.0.1:${target}` } } } } });

it('uses 443 when nothing is served', () => expect(choosePort({}, name, 4444)).toEqual({ port: 443, exists: false }));
it('reuses the port already proxying to Webr', () => expect(choosePort(serving(8443, 4444), name, 4444)).toEqual({ port: 8443, exists: true }));
it('skips ports used by other services', () => expect(choosePort(serving(443, 3000), name, 4444)).toEqual({ port: 8443, exists: false }));
it('gives up when every HTTPS port is taken', () => {
  const taken = { TCP: { 443: {}, 8443: {}, 10000: {} } };
  expect(choosePort(taken, name, 4444).port).toBeUndefined();
});
