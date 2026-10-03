import type { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';

export const HMR_PATH = '/__vite_hmr';
const HMR_PROTOCOL = 'vite-hmr';

export function registerDevHmrProxy(app: FastifyInstance, vitePort: number) {
  app.get(HMR_PATH, { websocket: true }, (browser) => {
    const vite = new WebSocket(`ws://127.0.0.1:${vitePort}${HMR_PATH}`, HMR_PROTOCOL);
    const forwardedWhileConnecting: [Buffer, boolean][] = [];
    browser.on('message', (data, isBinary) => { if (vite.readyState === WebSocket.OPEN) vite.send(data, { binary: isBinary }); else forwardedWhileConnecting.push([data as Buffer, isBinary]); });
    vite.on('open', () => forwardedWhileConnecting.forEach(([data, isBinary]) => vite.send(data, { binary: isBinary })));
    vite.on('message', (data, isBinary) => browser.send(data, { binary: isBinary }));
    for (const [from, to] of [[browser, vite], [vite, browser]] as const) { from.on('close', () => to.close()); from.on('error', () => to.close()); }
  });
}
