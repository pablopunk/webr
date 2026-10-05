import { createServer, type Server, type Socket } from 'node:net';
import { rm } from 'node:fs/promises';
import { NdjsonParser } from '../../src/server/protocol/ndjson';
import type { NativeSnapshot } from '../../src/server/protocol/native';

type Handler = (params: Record<string, unknown>) => Record<string, unknown>;
const reply = (socket: Socket, value: unknown) => socket.write(JSON.stringify(value) + '\n');

export async function startFakeHerdr(socketPath: string, snapshot: () => NativeSnapshot): Promise<Server> {
  const handlers: Record<string, Handler> = {
    ping: () => ({ type: 'pong', protocol: 22, version: '0.9.3' }),
    'session.snapshot': () => ({ snapshot: snapshot() }),
    'worktree.list': () => ({ worktrees: [] }),
    'pane.focus': () => ({}),
    'server.agent_manifests': () => ({ manifests: [] }),
  };
  const server = createServer((socket) => {
    socket.on('error', () => {});
    const parser = new NdjsonParser((value) => {
      const { id, method, params } = value as { id: string; method: string; params?: Record<string, unknown> };
      if (method === 'events.subscribe') { reply(socket, { id, result: { type: 'subscription_started' } }); return; }
      const handler = handlers[method];
      if (handler) reply(socket, { id, result: handler(params ?? {}) });
      else { console.error(`fake herdr: unhandled method ${method}`); reply(socket, { id, error: { code: 'unsupported_in_demo', message: method } }); }
    });
    socket.on('data', (chunk) => { try { parser.push(chunk); } catch { socket.destroy(); } });
  });
  await rm(socketPath, { force: true });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  return server;
}
