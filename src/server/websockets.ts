import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { RuntimeManager } from './runtime/manager';
import type { GatewayAuth } from './auth';
import { TerminalHub } from './terminal/hub';
import { terminalAction } from '../shared/runtime';
import { z } from 'zod';

export function registerWebsockets(app: FastifyInstance, manager: RuntimeManager, auth: GatewayAuth) {
  const hub = new TerminalHub(manager);
  const pairs = new Map<string, { metadata?: WebSocket; terminal?: WebSocket; close: () => void }>();
  for (const kind of ['metadata', 'terminal'] as const) {
    app.get(`/api/ws/${kind}`, { websocket: true }, (socket, request) => {
      const parsed = z.object({ instance: z.uuid() }).strict().safeParse(request.query);
      if (!parsed.success || !request.gatewaySession) { socket.close(1008); return; }
      const owner = request.gatewaySession.sessionId + '\0' + parsed.data.instance;
      let pair = pairs.get(owner);
      if (!pair) {
        if (pairs.size >= 32) { socket.close(1013); return; }
        let interval: ReturnType<typeof setInterval> | undefined;
        let pairing: ReturnType<typeof setTimeout> | undefined;
        const publish = (projection: unknown) => {
          if (!pair?.metadata || pair.metadata.readyState !== 1) return;
          const value = JSON.stringify({ type: 'projection', projection });
          if (Buffer.byteLength(value) + pair.metadata.bufferedAmount > 2 * 1024 * 1024) { pair.close(); return; }
          pair.metadata.send(value);
        };
        const close = () => {
          if (!pairs.has(owner)) return;
          pairs.delete(owner); clearInterval(interval); clearTimeout(pairing);
          manager.off('projection', publish); hub.detach(owner);
          pair?.metadata?.close(1008); pair?.terminal?.close(1008);
        };
        pair = { close }; pairs.set(owner, pair);
        manager.on('projection', publish);
        interval = setInterval(() => { void auth.authenticate(request.headers).then((session) => { if (!session) close(); }).catch(close); }, 1000);
        pairing = setTimeout(() => { if (!pair?.metadata || !pair.terminal) close(); }, 5000);
        interval.unref(); pairing.unref();
      }
      if (pair[kind]) { socket.close(1008); return; }
      pair[kind] = socket;
      if (kind === 'terminal') hub.attach(owner, socket);
      let pending = 0;
      let commands = Promise.resolve();
      socket.on('message', (data, binary) => {
        if (binary || kind !== 'terminal' || ++pending > 16) { pair!.close(); return; }
        let value: unknown;
        try { value = JSON.parse(data.toString()); } catch { pair!.close(); return; }
        const validated = terminalAction.safeParse(value);
        if (!validated.success) { pair!.close(); return; }
        commands = commands.then(async () => {
          if (!pairs.has(owner)) return;
          if (!pair?.metadata || !pair.terminal || !await auth.authenticate(request.headers)) { pair!.close(); return; }
          try { hub.action(owner, validated.data); }
          catch (error) { if (socket.readyState === 1) socket.send(JSON.stringify({ type: 'stream.error', streamId: validated.data.streamId, generation: validated.data.generation, reason: error instanceof Error ? error.message : 'action_failed' })); }
        }).catch(() => pair!.close()).finally(() => { --pending; });
      });
      socket.on('error', () => pair!.close());
      socket.on('close', () => pair!.close());
      if (kind === 'metadata') for (const projection of manager.bootstrap().projections) socket.send(JSON.stringify({ type: 'projection', projection }));
    });
  }
  app.addHook('onClose', async () => { for (const pair of pairs.values()) pair.close(); });
  return hub;
}
