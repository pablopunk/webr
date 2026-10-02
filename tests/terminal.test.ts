import { afterEach, expect, it, vi } from 'vitest';
import { Writable } from 'node:stream';
import type { WebSocket } from 'ws';
import { TerminalHub } from '../src/server/terminal/hub';
import { MetadataDatabase } from '../src/server/storage/database';
import { RuntimeManager } from '../src/server/runtime/manager';
import { FrameSequence, decodeFrame, encodeFrame } from '../src/shared/frame';
import { OrderedWriter, encodeUserInput } from '../src/server/terminal/writer';
import { frame, FakeTarget } from './fixtures/target';

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.useRealTimers(); });
class FakeSocket { readyState = 1; bufferedAmount = 0; packets: (string | Uint8Array)[] = []; send(packet: string | Uint8Array) { this.packets.push(packet); } }
async function setup(budget = 512 * 1024) {
  const db = new MetadataDatabase(':memory:'); cleanup.push(() => db.close());
  const target = new FakeTarget(); const manager = new RuntimeManager(db, [target]); cleanup.push(() => manager.close()); manager.start();
  await expect.poll(() => manager.bootstrap().machines[0].connected).toBe(true);
  const hub = new TerminalHub(manager, budget, budget * 2); cleanup.push(() => hub.close());
  const one = new FakeSocket(); const two = new FakeSocket(); hub.attach('one', one as unknown as WebSocket); hub.attach('two', two as unknown as WebSocket);
  const open = { type: 'open' as const, streamId: 1, generation: 1, machineId: target.id, threadId: manager.bootstrap().threads[0].id, terminalId: 'term_fixture', cols: 80, rows: 24, mode: 'control' as const, takeover: false };
  return { target, manager, hub, one, two, open };
}
it('requires a full baseline, validates headers and rejects sequence gaps', () => {
  const value = { ...frame(), streamId: 1, generation: 4 };
  expect(decodeFrame(encodeFrame(value))).toEqual({ ...value, bytes: new Uint8Array(value.bytes) });
  expect(() => new FrameSequence().accept({ ...value, full: false })).toThrow('baseline_required');
  const sequence = new FrameSequence(); sequence.accept(value); expect(() => sequence.accept({ ...value, seq: 3, full: false })).toThrow('sequence_gap');
  const broken = encodeFrame(value); broken[24] = 1; expect(() => decodeFrame(broken)).toThrow('invalid_frame');
});
it('credits a viewer only after an ordered ACK and enforces byte budgets without dropping deltas', async () => {
  const { target, hub, open } = await setup(200);
  hub.action('one', open); target.streams[0].onFrame(frame(1, true, 100)); expect(hub.stats().bytes).toBe(132);
  hub.action('one', { type: 'ack', streamId: 1, generation: 1, seq: 1 }); expect(hub.stats().bytes).toBe(0);
  target.streams[0].onFrame(frame(2, false, 100)); target.streams[0].onFrame(frame(3, false, 100));
  expect(target.streams[0].closed).toBe(true); expect(hub.stats().bytes).toBe(0); expect(hub.stats().controllers).toBe(0);
});
it('closes a stream on a sequence gap and on a stale ACK', async () => {
  const { target, hub, open } = await setup(); hub.action('one', open);
  target.streams[0].onFrame(frame(1)); target.streams[0].onFrame(frame(3, false)); expect(target.streams[0].closed).toBe(true);
  expect(() => hub.action('one', { type: 'ack', streamId: 1, generation: 1, seq: 1 })).toThrow('stale_lease');
});
const bytesOf = (socket: FakeSocket) => socket.packets.filter((packet): packet is Uint8Array => typeof packet !== 'string').map((packet) => decodeFrame(packet));
const noticesOf = (socket: FakeSocket) => socket.packets.filter((packet): packet is string => typeof packet === 'string').map((packet) => JSON.parse(packet));
const acknowledge = (hub: TerminalHub, owner: string, streamId: number, seq: number) => hub.action(owner, { type: 'ack', streamId, generation: 1, seq });
it('shares one upstream control stream and lets both tabs type in arrival order', async () => {
  const { target, hub, one, two, open } = await setup(); hub.action('one', open);
  target.streams[0].onFrame(frame(1, true)); acknowledge(hub, 'one', 1, 1);
  hub.action('two', { ...open, cols: 100, rows: 30 });
  expect(target.streams).toHaveLength(1); expect(target.streams[0].commands).toEqual([{ type: 'terminal.resize', cols: 100, rows: 30 }]);
  target.streams[0].onFrame({ ...frame(2, false), width: 80, height: 24 }); expect(bytesOf(two)).toHaveLength(0);
  target.streams[0].onFrame({ ...frame(3, true), width: 100, height: 30 });
  expect(bytesOf(two).map((item) => [item.seq, item.full, item.width])).toEqual([[1, true, 100]]);
  expect(bytesOf(one).map((item) => item.seq)).toEqual([1, 2, 3]);
  acknowledge(hub, 'two', 1, 1);
  hub.action('one', { type: 'input', streamId: 1, generation: 1, text: 'a', paste: false });
  hub.action('two', { type: 'input', streamId: 1, generation: 1, text: 'b', paste: false });
  expect(target.streams[0].commands.slice(1)).toEqual([{ type: 'terminal.input', text: 'a' }, { type: 'terminal.input', text: 'b' }]);
  expect(hub.stats().controllers).toBe(1);
});
it('keeps control for the remaining tab and closes upstream only after the last tab leaves', async () => {
  const { target, hub, open } = await setup(); hub.action('one', open); hub.action('two', open);
  hub.action('one', { type: 'release', streamId: 1, generation: 1 }); expect(target.streams[0].closed).toBe(false);
  hub.action('two', { type: 'release', streamId: 1, generation: 1 }); expect(target.streams[0].closed).toBe(true); expect(hub.stats().controllers).toBe(0);
  expect(() => hub.action('two', { type: 'input', streamId: 1, generation: 1, text: 'x', paste: false })).toThrow('stale_lease');
});
it('does not stall a fast tab when another tab stops acknowledging', async () => {
  const { target, hub, one, two, open } = await setup(2000); hub.action('one', open); hub.action('two', open);
  target.streams[0].onFrame(frame(1, true, 700)); acknowledge(hub, 'one', 1, 1);
  target.streams[0].onFrame(frame(2, false, 700)); target.streams[0].onFrame(frame(3, false, 700));
  expect(noticesOf(two).some((notice) => notice.type === 'stream.closed' && notice.reason === 'stream_resync_required')).toBe(true);
  expect(target.streams[0].closed).toBe(false);
  acknowledge(hub, 'one', 1, 2); acknowledge(hub, 'one', 1, 3); expect(bytesOf(one).map((item) => item.seq)).toEqual([1, 2, 3]);
});
it('reports a controller owned by another client to every tab and requires an explicit takeover to ask again', async () => {
  const { target, hub, two, open } = await setup(); hub.action('two', open);
  target.streams[0].onClose('controller_conflict');
  expect(noticesOf(two).find((notice) => notice.type === 'stream.closed')?.reason).toBe('controller_conflict');
  expect(hub.stats().controllers).toBe(0);
  hub.action('two', { ...open, streamId: 2, generation: 2, takeover: true }); expect(target.streams).toHaveLength(2);
});
it('does not give observers scroll, input or resize authority', async () => {
  const { hub, open } = await setup(); hub.action('one', { ...open, mode: 'observe' });
  expect(() => hub.action('one', { type: 'resize', streamId: 1, generation: 1, cols: 100, rows: 30 })).toThrow('observer_read_only');
  expect(() => hub.action('one', { type: 'scroll', streamId: 1, generation: 1, direction: 'up', lines: 1 })).toThrow('observer_read_only');
});
it('revokes all leases on binding deletion and disconnect', async () => {
  const { target, hub, open, manager } = await setup(); hub.action('one', open);
  target.state.panes = []; target.event!();
  await expect.poll(() => target.streams[0].closed).toBe(true);
  expect(() => manager.binding(open.machineId, open.threadId, open.terminalId)).toThrow('binding_invalid'); expect(hub.stats().controllers).toBe(0);
});
it('bounds input by UTF-8 bytes and rejects nested paste envelopes', () => {
  expect(encodeUserInput('á🙂\n', true)).toBe('\x1b[200~á🙂\n\x1b[201~');
  expect(() => encodeUserInput('\x1b[201~', true)).toThrow('invalid_input');
  expect(() => encodeUserInput('🙂'.repeat(3000), false)).toThrow('invalid_input');
});
it('writes commands in order without waiting for RPC responses and fails a blocked writer', async () => {
  const output: string[] = []; const writer = new OrderedWriter(new Writable({ write(chunk, _encoding, callback) { output.push(chunk.toString()); callback(); } }), () => {});
  writer.send({ type: 'terminal.input', text: 'a' }); writer.send({ type: 'terminal.resize', cols: 80, rows: 24 });
  await expect.poll(() => output.length).toBe(2);
  expect(output.map((line) => JSON.parse(line).type)).toEqual(['terminal.input', 'terminal.resize']); writer.close();
  const fail = vi.fn(); const blocked = new OrderedWriter(new Writable({ write() {} }), fail, 100, 20);
  blocked.send({ type: 'terminal.input', text: 'a' }); await expect.poll(() => fail.mock.calls.length).toBe(1);
  expect(() => blocked.send({ type: 'terminal.input', text: 'b' })).toThrow('writer_closed');
});
it('rejects input until baseline ACK and revokes an expired capability lease without another input action', async () => {
  const { target, hub, open } = await setup(); hub.action('one', open);
  expect(() => hub.action('one', { type: 'input', streamId: 1, generation: 1, text: 'early', paste: false })).toThrow('baseline_not_acknowledged');
  target.streams[0].onFrame(frame()); hub.action('one', { type: 'ack', streamId: 1, generation: 1, seq: 1 }); hub.action('one', { type: 'input', streamId: 1, generation: 1, text: 'valid', paste: false }); expect(target.streams[0].commands).toHaveLength(1);
  target.writable = false; await expect.poll(() => target.streams[0].closed).toBe(true); expect(hub.stats().controllers).toBe(0);
});
it('survives a child that already closed its stdin when the terminal is closed', async () => {
  const { openCliStream } = await import('../src/server/terminal/cli');
  const script = `exec 0<&-; sleep 0.2; echo '{"type":"terminal.closed","reason":"terminal closed"}'`;
  const reason = await new Promise<string>((done) => openCliStream('sh', ['-c', script], {}, () => {}, done));
  expect(reason).toBe('terminal_closed');
  await new Promise((done) => setTimeout(done, 100));
});
