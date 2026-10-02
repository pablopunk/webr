import { afterEach, expect, it, vi } from 'vitest';
import type { Terminal } from '@xterm/xterm';
import { BrowserTerminalManager } from '../src/client/terminal-manager';
import { TerminalRenderer } from '../src/client/terminal-renderer';
import { encodeFrame } from '../src/shared/frame';
import { frame } from './fixtures/target';
import { QueryClient } from '@tanstack/react-query';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });
class BrowserSocket {
  static OPEN = 1; static instances: BrowserSocket[] = [];
  readyState = 0; bufferedAmount = 0; binaryType = ''; sent: string[] = [];
  onopen?: () => void; onclose?: () => void; onerror?: () => void; onmessage?: (event: { data: string | ArrayBuffer }) => void;
  constructor(readonly url: string) { BrowserSocket.instances.push(this); }
  open() { this.readyState = 1; this.onopen?.(); }
  close() { this.readyState = 3; this.onclose?.(); }
  send(value: string) { this.sent.push(value); }
}
function setup() {
  vi.useFakeTimers(); BrowserSocket.instances = [];
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  vi.stubGlobal('WebSocket', BrowserSocket); vi.stubGlobal('location', { protocol: 'http:', host: 'localhost:4321' });
  const writes: { bytes: Uint8Array; finish: () => void }[] = [];
  const terminal = { resize: vi.fn(), write: (bytes: Uint8Array, finish: () => void) => writes.push({ bytes, finish }) } as unknown as Terminal;
  const manager = new BrowserTerminalManager(() => {}, () => {}); manager.start();
  const [metadata, binary] = BrowserSocket.instances; metadata.open(); binary.open();
  const onState = vi.fn();
  const pane = manager.mount({ machineId: 'fixture', threadId: '00000000-0000-4000-8000-000000000001', terminalId: 'term_fixture', terminal, mode: 'observe', cols: 80, rows: 24, onState });
  const open = JSON.parse(binary.sent[0]);
  return { manager, pane, metadata, binary, writes, terminal, open, onState };
}
it('opens only two app sockets and ACKs binary output only after xterm finishes it', () => {
  const { manager, binary, writes, open, pane } = setup();
  expect(BrowserSocket.instances).toHaveLength(2);
  binary.onmessage!({ data: encodeFrame({ ...frame(), streamId: open.streamId, generation: open.generation }).buffer as ArrayBuffer });
  expect(binary.sent.map((message) => JSON.parse(message).type)).toEqual(['open']);
  writes[0].finish(); expect(JSON.parse(binary.sent[1]).type).toBe('ack');
  pane.close(); expect(JSON.parse(binary.sent.at(-1)!).type).toBe('release'); manager.stop();
});
it('ignores stale stream generations and never replays input after reconnect', () => {
  const { manager, binary, open, pane, writes } = setup();
  pane.control(); const writable = JSON.parse(binary.sent.at(-1)!);
  binary.onmessage!({ data: JSON.stringify({ type: 'stream.opened', streamId: open.streamId, generation: writable.generation, writable: true }) });
  pane.input('before baseline'); expect(JSON.parse(binary.sent.at(-1)!).type).toBe('open');
  binary.onmessage!({ data: encodeFrame({ ...frame(), streamId: open.streamId, generation: writable.generation }).buffer as ArrayBuffer }); writes[0].finish();
  pane.input('a'); expect(JSON.parse(binary.sent.at(-1)!).text).toBe('a');
  binary.onmessage!({ data: encodeFrame({ ...frame(), streamId: open.streamId, generation: open.generation }).buffer as ArrayBuffer }); expect(writes).toHaveLength(1);
  binary.close(); pane.input('must not queue'); vi.advanceTimersByTime(1000);
  BrowserSocket.instances[2].open(); BrowserSocket.instances[3].open();
  const reconnectCommands = BrowserSocket.instances[3].sent.map((message) => JSON.parse(message));
  expect(reconnectCommands).toHaveLength(1); expect(reconnectCommands[0].mode).toBe('observe'); expect(reconnectCommands[0].type).toBe('open'); manager.stop();
});
it('keeps a controller conflict visible until an explicit takeover', () => {
  const { manager, pane, binary, open, onState } = setup(); pane.control();
  const control = JSON.parse(binary.sent.at(-1)!);
  binary.onmessage!({ data: JSON.stringify({ type: 'stream.error', streamId: open.streamId, generation: control.generation, reason: 'controller_conflict' }) });
  const observer = JSON.parse(binary.sent.at(-1)!);
  binary.onmessage!({ data: JSON.stringify({ type: 'stream.opened', streamId: open.streamId, generation: observer.generation, writable: false }) });
  expect(onState.mock.calls.at(-1)).toEqual(['Another controller owns this terminal.', false]);
  pane.input('not sent'); expect(binary.sent.some((value) => JSON.parse(value).type === 'input')).toBe(false);
  pane.control(true); expect(JSON.parse(binary.sent.at(-1)!).takeover).toBe(true);
  expect(onState.mock.calls.at(-1)).toEqual(['Waiting for terminal control.', false]); manager.stop();
});
it('recreates a fresh baseline after a sequence gap instead of accepting missing deltas', () => {
  const { manager, binary, open } = setup();
  const send = (seq: number, full: boolean) => binary.onmessage!({ data: encodeFrame({ ...frame(seq, full), streamId: open.streamId, generation: open.generation }).buffer as ArrayBuffer });
  send(1, true); send(3, false); expect(binary.readyState).toBe(3); manager.stop();
});
it('bounds renderer memory and preserves frame dimensions and write order', () => {
  const writes: (() => void)[] = []; const dimensions: [number, number][] = []; const acknowledgements: number[] = [];
  const renderer = new TerminalRenderer({ resize: (cols, rows) => dimensions.push([cols, rows]), write: (_bytes, callback) => { writes.push(callback!); } }, (frame) => acknowledgements.push(frame.seq), 80);
  renderer.push({ ...frame(1, true, 32), streamId: 1, generation: 1 }); renderer.push({ ...frame(2, false, 32), streamId: 1, generation: 1, width: 40 });
  expect(dimensions).toEqual([[80, 24]]); expect(() => renderer.push({ ...frame(3, false, 32), streamId: 1, generation: 1 })).toThrow('renderer_overload');
  writes[0](); expect(dimensions).toEqual([[80, 24], [40, 24]]); expect(acknowledgements).toEqual([1]);
  renderer.close(); writes[1](); expect(acknowledgements).toEqual([1]);
});
it('cancels catalog reads for a stale machine key without installing the late response on the new host', async () => {
  vi.useRealTimers(); const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let resolve!: (value: string) => void; let aborted = false;
  const first = client.query({ queryKey: ['catalog', 'first'], queryFn: ({ signal }) => { signal.addEventListener('abort', () => { aborted = true; }); return new Promise<string>((finish) => { resolve = finish; }); } }).catch(() => undefined);
  await client.cancelQueries({ queryKey: ['catalog', 'first'] });
  await client.query({ queryKey: ['catalog', 'second'], queryFn: async () => 'second-only' }); resolve('stale-first'); await first;
  expect(aborted).toBe(true); expect(client.getQueryData(['catalog', 'first'])).toBeUndefined(); expect(client.getQueryData(['catalog', 'second'])).toBe('second-only'); client.clear();
});
it('requires open acceptance and a rendered full baseline, and rejects old-generation ACK and input after replacement', () => {
  const { manager, pane, binary, open, writes } = setup(); pane.control(); const command = JSON.parse(binary.sent.at(-1)!);
  pane.input('before open'); binary.onmessage!({ data: JSON.stringify({ type: 'stream.opened', streamId: open.streamId, generation: command.generation, writable: true }) }); pane.input('before full');
  binary.onmessage!({ data: encodeFrame({ ...frame(), streamId: open.streamId, generation: command.generation }).buffer as ArrayBuffer }); pane.input('before render');
  expect(binary.sent.some((value) => JSON.parse(value).type === 'input')).toBe(false);
  pane.observe(); const replaced = JSON.parse(binary.sent.at(-1)!); writes[0].finish(); binary.onmessage!({ data: JSON.stringify({ type: 'stream.opened', streamId: open.streamId, generation: command.generation, writable: true }) }); pane.input('after old open');
  expect(binary.sent.some((value) => JSON.parse(value).type === 'ack')).toBe(false); expect(replaced.generation).not.toBe(command.generation); expect(binary.sent.some((value) => JSON.parse(value).type === 'input')).toBe(false); manager.stop();
});
it('disables input immediately during resize and requires a matching rendered full baseline to resume', () => {
  const { manager, pane, binary, open, writes } = setup(); pane.control(); const command = JSON.parse(binary.sent.at(-1)!);
  binary.onmessage!({ data: JSON.stringify({ type: 'stream.opened', streamId: open.streamId, generation: command.generation, writable: true }) });
  const deliver = (seq: number, full: boolean, width = 80, height = 24) => binary.onmessage!({ data: encodeFrame({ ...frame(seq, full), width, height, streamId: open.streamId, generation: command.generation }).buffer as ArrayBuffer });
  deliver(1, true); writes[0].finish(); deliver(2, false); pane.resize(120, 30); pane.input('must not send'); writes[1].finish(); pane.input('still no new baseline');
  expect(binary.sent.some((value) => JSON.parse(value).type === 'input')).toBe(false); deliver(3, true, 120, 30); writes[2].finish(); pane.input('safe now'); expect(JSON.parse(binary.sent.at(-1)!).text).toBe('safe now'); manager.stop();
});
it('keeps established input writable during sustained delta rendering without replaying input across takeover', () => {
  const { manager, pane, binary, open, writes, onState } = setup(); pane.control(); const control = JSON.parse(binary.sent.at(-1)!);
  const accepted = (generation: number) => binary.onmessage!({ data: JSON.stringify({ type: 'stream.opened', streamId: open.streamId, generation, writable: true }) });
  const deliver = (generation: number, seq: number, full: boolean, width = 80, height = 24) => binary.onmessage!({ data: encodeFrame({ ...frame(seq, full), width, height, streamId: open.streamId, generation }).buffer as ArrayBuffer });
  const inputs = () => binary.sent.map((message) => JSON.parse(message)).filter((message) => message.type === 'input');
  accepted(control.generation); deliver(control.generation, 1, true); deliver(control.generation, 2, false); deliver(control.generation, 3, false);
  pane.input('not before baseline'); expect(inputs()).toHaveLength(0); writes[0].finish();
  expect(writes).toHaveLength(2); expect(onState.mock.calls.at(-1)?.[1]).toBe(true);
  pane.input('during first delta'); expect(inputs().at(-1)?.text).toBe('during first delta');
  writes[1].finish(); pane.input('during second delta'); expect(inputs().at(-1)?.text).toBe('during second delta');
  pane.control(true); const takeover = JSON.parse(binary.sent.at(-1)!); expect(takeover.takeover).toBe(true); expect(onState.mock.calls.at(-1)?.[1]).toBe(false);
  writes[2].finish(); accepted(control.generation); pane.input('old acceptance must not authorize'); expect(inputs()).toHaveLength(2);
  accepted(takeover.generation); deliver(takeover.generation, 1, true); pane.input('not before takeover render'); expect(inputs()).toHaveLength(2); writes[3].finish();
  pane.input('new lease'); expect(inputs().at(-1)?.generation).toBe(takeover.generation); expect(inputs()).toHaveLength(3);
  deliver(takeover.generation, 2, false); pane.resize(120, 30); expect(onState.mock.calls.at(-1)?.[1]).toBe(false); pane.input('not during resize'); writes[4].finish(); expect(inputs()).toHaveLength(3);
  deliver(takeover.generation, 3, true); writes[5].finish(); pane.input('wrong baseline size'); expect(inputs()).toHaveLength(3);
  deliver(takeover.generation, 4, true, 120, 30); deliver(takeover.generation, 5, false, 120, 30); writes[6].finish();
  expect(onState.mock.calls.at(-1)?.[1]).toBe(true); pane.input('resized baseline with delta pending'); expect(inputs().at(-1)?.text).toBe('resized baseline with delta pending'); expect(inputs()).toHaveLength(4);
  manager.stop();
});
