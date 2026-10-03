import { afterEach, expect, it } from 'vitest';
import { MetadataDatabase } from '../src/server/storage/database';
import { createHost } from '../src/server/host';
import { RuntimeManager } from '../src/server/runtime/manager';
import type { Transcriber, VoiceState } from '../src/server/voice/transcriber';
import { FakeTarget } from './fixtures/target';

const cleanups: (() => Promise<unknown> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

const local = { host: 'localhost:4321', origin: 'http://localhost:4321' };

async function setup(state: VoiceState) {
  const heard: { samples: Float32Array; sampleRate: number }[] = [];
  const transcriber = { state: async () => state, warm: async () => undefined, close: () => undefined, transcribe: async (samples: Float32Array, sampleRate: number) => { heard.push({ samples, sampleRate }); return 'hello world'; } } as unknown as Transcriber;
  const database = new MetadataDatabase(':memory:'); cleanups.push(() => database.close());
  const app = await createHost(new RuntimeManager(database, [new FakeTarget()]), 'http://localhost:4321', undefined, undefined, undefined, {}, { transcriber }); cleanups.push(() => app.close());
  const post = (url: string, payload: Buffer) => app.inject({ method: 'POST', url, headers: { ...local, 'content-type': 'audio/l16' }, remoteAddress: '127.0.0.1', payload });
  return { app, heard, post };
}

it('reports whether voice input can run', async () => {
  const { app } = await setup('needs-download');
  expect((await app.inject({ url: '/api/voice', headers: local, remoteAddress: '127.0.0.1' })).json()).toEqual({ state: 'needs-download' });
});

it('transcribes 16-bit PCM as normalized samples', async () => {
  const { heard, post } = await setup('ready');
  const pcm = Buffer.alloc(4); pcm.writeInt16LE(16384, 0); pcm.writeInt16LE(-32768, 2);
  const response = await post('/api/voice/transcribe?sampleRate=16000', pcm);
  expect(response.json()).toEqual({ text: 'hello world' });
  expect([...heard[0].samples]).toEqual([0.5, -1]);
  expect(heard[0].sampleRate).toBe(16000);
});

it('refuses audio when the recognizer is not installed', async () => {
  const { post } = await setup('unavailable');
  expect((await post('/api/voice/transcribe?sampleRate=16000', Buffer.alloc(2))).statusCode).toBe(409);
});
