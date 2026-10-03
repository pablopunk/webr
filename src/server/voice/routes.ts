import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Transcriber } from './transcriber';

const PCM_CONTENT_TYPE = 'audio/l16';
const MAX_SECONDS = 600;
const MAX_SAMPLE_RATE = 48_000;
export const MAX_VOICE_BYTES = MAX_SECONDS * MAX_SAMPLE_RATE * 2;

const int16ToFloat32 = (pcm: Buffer) => {
  const samples = new Float32Array(Math.floor(pcm.length / 2));
  for (let index = 0; index < samples.length; index++) samples[index] = pcm.readInt16LE(index * 2) / 32768;
  return samples;
};

export function registerVoiceRoutes(app: FastifyInstance, transcriber: Transcriber) {
  app.addContentTypeParser(PCM_CONTENT_TYPE, { parseAs: 'buffer', bodyLimit: MAX_VOICE_BYTES }, (_request, body, done) => done(null, body));
  app.get('/api/voice', async () => ({ state: await transcriber.state() }));
  app.post('/api/voice/warm', async () => {
    void transcriber.warm().catch(() => undefined);
    return { state: await transcriber.state() };
  });
  app.post('/api/voice/transcribe', { bodyLimit: MAX_VOICE_BYTES }, async (request, reply) => {
    const { sampleRate } = z.object({ sampleRate: z.coerce.number().int().min(8000).max(MAX_SAMPLE_RATE) }).strict().parse(request.query);
    if (!Buffer.isBuffer(request.body) || !request.body.length) return reply.code(400).send({ error: 'invalid_request' });
    if (await transcriber.state() === 'unavailable') return reply.code(409).send({ error: 'voice_unavailable' });
    return { text: await transcriber.transcribe(int16ToFloat32(request.body), sampleRate) };
  });
}
