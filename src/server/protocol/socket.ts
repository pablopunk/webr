import { connect, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { NdjsonParser } from './ndjson';
import { lifecycleSubscriptions } from './native';
import { requestDeadline, type RpcOptions } from './deadlines';

const envelope = z.object({ id: z.string(), result: z.record(z.string(), z.unknown()).optional(), error: z.object({ code: z.string(), message: z.string() }).optional() });
const allowed = new Set(['ping', 'session.snapshot', 'events.subscribe', 'server.agent_manifests', 'worktree.create', 'tab.create', 'agent.start', 'agent.get', 'agent.prompt']);
export class SocketApi {
  private sockets = new Set<Socket>();
  constructor(readonly path: string, readonly deadline = 5000) {}
  request(method: string, params: Record<string, unknown> = {}, options?: RpcOptions): Promise<Record<string, unknown>> {
    if (!allowed.has(method) || method === 'events.subscribe') return Promise.reject(new Error('method_not_allowed'));
    let deadline: number;
    try { deadline = requestDeadline(method, params, this.deadline, options); } catch (error) { return Promise.reject(error); }
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const socket = this.open();
      let done = false;
      const finish = (error?: Error, result?: Record<string, unknown>) => {
        if (done) return;
        done = true; clearTimeout(timer); socket.destroy();
        if (error) reject(error); else resolve(result!);
      };
      const timer = setTimeout(() => finish(new Error('rpc_timeout')), deadline);
      const parser = new NdjsonParser((value) => {
        const record = envelope.parse(value);
        if (record.id !== id) throw new Error('request_id_mismatch');
        if (record.error) throw new Error(record.error.code);
        if (!record.result) throw new Error('missing_result');
        finish(undefined, record.result);
      });
      socket.on('connect', () => socket.write(JSON.stringify({ id, method, params }) + '\n'));
      socket.on('data', (chunk) => { try { parser.push(chunk); } catch (error) { finish(error as Error); } });
      socket.on('error', () => finish(new Error('socket_unavailable')));
      socket.on('close', () => finish(new Error('rpc_closed')));
      socket.on('end', () => { try { parser.end(); finish(new Error('rpc_closed')); } catch (error) { finish(error as Error); } });
    });
  }
  subscribe(onEvent: () => void, onClose: (reason: string) => void, paneIds: string[] = []): Promise<() => void> {
    return new Promise((resolve, reject) => {
      const socket = this.open();
      const id = randomUUID();
      let acknowledged = false;
      let closed = false;
      const stop = (reason: string, notify = true) => {
        if (closed) return;
        closed = true; clearTimeout(timer); socket.destroy();
        if (!acknowledged) reject(new Error(reason));
        else if (notify) onClose(reason);
      };
      const timer = setTimeout(() => stop('subscription_timeout'), this.deadline);
      const parser = new NdjsonParser((value) => {
        const response = envelope.safeParse(value);
        if (response.success) {
          if (response.data.id !== id) throw new Error('request_id_mismatch');
          if (response.data.error) throw new Error(response.data.error.code);
          if (acknowledged || response.data.result?.type !== 'subscription_started') throw new Error('invalid_ack');
          acknowledged = true; clearTimeout(timer); resolve(() => stop('released', false));
        } else {
          z.object({ event: z.string(), data: z.unknown() }).parse(value);
          if (!acknowledged) throw new Error('event_before_ack');
          onEvent();
        }
      });
      socket.on('connect', () => socket.write(JSON.stringify({ id, method: 'events.subscribe', params: { subscriptions: [...lifecycleSubscriptions, ...paneIds.map((pane_id) => ({ type: 'pane.agent_status_changed', pane_id }))] } }) + '\n'));
      socket.on('data', (chunk) => { try { parser.push(chunk); } catch (error) { stop((error as Error).message); } });
      socket.on('error', () => stop('socket_unavailable'));
      socket.on('end', () => stop('subscription_closed'));
      socket.on('close', () => stop('subscription_closed'));
    });
  }
  close() { for (const socket of this.sockets) socket.destroy(); }
  private open() {
    const socket = connect(this.path);
    this.sockets.add(socket);
    socket.once('close', () => this.sockets.delete(socket));
    return socket;
  }
}
