import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { RuntimeManager } from './runtime/manager';
import { TerminalHub } from './terminal/hub';
import { terminalAction } from '../shared/runtime';
import { z } from 'zod';

export function registerWebsockets(app: FastifyInstance, manager: RuntimeManager) {
  const hub = new TerminalHub(manager);
  const pairs = new Map<string, { metadata?: WebSocket; terminal?: WebSocket; close: () => void }>();
  for (const kind of ['metadata', 'terminal'] as const) {
    app.get(`/api/ws/${kind}`, { websocket: true }, (socket, request) => {
      const parsed = z.object({ instance: z.uuid() }).strict().safeParse(request.query);
      if (!parsed.success) { socket.close(1008); return; }
      const owner = parsed.data.instance;
      let pair = pairs.get(owner);
      if (!pair) {
        if (pairs.size >= 32) { socket.close(1013); return; }
        let pairing: ReturnType<typeof setTimeout> | undefined;
        const publish = (projection: unknown) => {
          if (!pair?.metadata || pair.metadata.readyState !== 1) return;
          const value = JSON.stringify({ type: 'projection', projection });
          if (Buffer.byteLength(value) + pair.metadata.bufferedAmount > 2 * 1024 * 1024) { pair.close(); return; }
          pair.metadata.send(value);
        };
        const close = () => {
          if (!pairs.has(owner)) return;
          pairs.delete(owner); clearTimeout(pairing);
          manager.off('projection', publish); hub.detach(owner);
          pair?.metadata?.close(1008); pair?.terminal?.close(1008);
        };
        pair = { close }; pairs.set(owner, pair);
        manager.on('projection', publish);
        pairing = setTimeout(() => { if (!pair?.metadata || !pair.terminal) close(); }, 5000);
        pairing.unref();
      }
      if (pair[kind]) { socket.close(1008); return; }
      pair[kind] = socket;
      if (kind === 'terminal') hub.attach(owner, socket);
      const reportFailure = (action: { streamId: number; generation: number }, error: unknown) => { if (socket.readyState === 1) socket.send(JSON.stringify({ type: 'stream.error', streamId: action.streamId, generation: action.generation, reason: error instanceof Error ? error.message : 'action_failed' })); };
      socket.on('message', (data, binary) => {
        if (binary || kind !== 'terminal') { pair!.close(); return; }
        let value: unknown;
        try { value = JSON.parse(data.toString()); } catch { pair!.close(); return; }
        const validated = terminalAction.safeParse(value);
        if (!validated.success) { pair!.close(); return; }
        if (!pairs.has(owner)) return;
        if (!pair?.metadata || !pair.terminal) { pair!.close(); return; }
        try { hub.action(owner, validated.data); } catch (error) { reportFailure(validated.data, error); }
      });
      socket.on('error', () => pair!.close());
      socket.on('close', () => pair!.close());
      if (kind === 'metadata') for (const projection of manager.bootstrap().projections) socket.send(JSON.stringify({ type: 'projection', projection }));
    });
  }
  app.addHook('onClose', async () => { for (const pair of pairs.values()) pair.close(); hub.close(); });
  return hub;
}
