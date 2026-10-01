import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Socket } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NdjsonParser } from '../src/server/protocol/ndjson';
import { SocketApi } from '../src/server/protocol/socket';

const cleanup: (() => Promise<unknown> | void)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function fakeApi(handler: (socket: Socket) => void) {
  const directory = await mkdtemp(join(tmpdir(), 'ha-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const sockets = new Set<Socket>();
  const server = createServer((socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); handler(socket); });
  const path = join(directory, 'a');
  await new Promise<void>((resolve) => server.listen(path, resolve));
  cleanup.push(() => new Promise<void>((resolve) => { for (const socket of sockets) socket.destroy(); server.close(() => resolve()); }));
  const api = new SocketApi(path, 100);
  cleanup.push(() => api.close());
  return api;
}
describe('bounded NDJSON and one-request connections', () => {
  it('decodes partial UTF-8 and multiple bounded records', () => {
    const values: unknown[] = []; const parser = new NdjsonParser((value) => values.push(value), 32);
    const bytes = Buffer.from('{"text":"á"}\n{"n":2}\n');
    for (const byte of bytes) parser.push(Buffer.from([byte]));
    parser.end(); expect(values).toEqual([{ text: 'á' }, { n: 2 }]);
  });
  it.each(['not-json\n', '{}', 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\n'])('rejects malformed, partial and oversized records: %s', (input) => {
    const parser = new NdjsonParser(() => {}, 32);
    expect(() => { parser.push(Buffer.from(input)); parser.end(); }).toThrow();
  });
  it('rejects invalid UTF-8', () => { expect(() => new NdjsonParser(() => {}).push(Buffer.from([0xff, 10]))).toThrow(); });
  it('uses a different connection for every ordinary RPC and matches IDs', async () => {
    let connections = 0; let requests = 0;
    const api = await fakeApi((socket) => { ++connections; socket.on('data', (bytes) => { ++requests; const record = JSON.parse(bytes.toString()); socket.end(JSON.stringify({ id: record.id, result: { type: 'pong' } }) + '\n'); }); });
    await api.request('ping'); await api.request('ping');
    expect(connections).toBe(2); expect(requests).toBe(2);
  });
  it('times out a quiet socket', async () => { const api = await fakeApi(() => {}); await expect(api.request('ping')).rejects.toThrow('rpc_timeout'); });
  it('rejects mismatched IDs without accepting the response', async () => { const api = await fakeApi((socket) => socket.on('data', () => socket.end('{"id":"wrong","result":{"type":"pong"}}\n'))); await expect(api.request('ping')).rejects.toThrow('request_id_mismatch'); });
  it('acks subscriptions before accepting events and reports events_lost', async () => {
    let lost: string | undefined;
    const api = await fakeApi((socket) => socket.on('data', (bytes) => {
      const { id } = JSON.parse(bytes.toString());
      socket.write(JSON.stringify({ id, result: { type: 'subscription_started' } }) + '\n');
      setTimeout(() => socket.end(JSON.stringify({ id, error: { code: 'events_lost', message: 'lost' } }) + '\n'), 10);
    }));
    await api.subscribe(() => {}, (reason) => { lost = reason; });
    await expect.poll(() => lost).toBe('events_lost');
  });
  it('does not expose unsafe RPC methods', async () => { const api = new SocketApi('/no-socket'); await expect(api.request('server.stop')).rejects.toThrow('method_not_allowed'); });
});
