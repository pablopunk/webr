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
  const hub = new TerminalHub(manager, budget, budget * 2); cleanup.push(() => { hub.detach('one'); hub.detach('two'); });
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
it('conflicts two controllers, supports only explicit takeover, and rejects stale input after release', async () => {
  const { target, hub, open } = await setup(); hub.action('one', open);
  expect(() => hub.action('two', open)).toThrow('controller_conflict');
  hub.action('two', { ...open, takeover: true }); expect(target.streams[0].closed).toBe(true);
  expect(() => hub.action('one', { type: 'input', streamId: 1, generation: 1, text: 'unsafe', paste: false })).toThrow('stale_lease');
  hub.action('two', { type: 'release', streamId: 1, generation: 1 });
  expect(() => hub.action('two', { type: 'input', streamId: 1, generation: 1, text: 'unsafe', paste: false })).toThrow('stale_lease');
  expect(target.streams.flatMap((stream) => stream.commands)).toEqual([]);
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
