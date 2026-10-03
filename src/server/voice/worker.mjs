import { createRequire } from 'node:module';

const { OfflineRecognizer } = createRequire(import.meta.url)('sherpa-onnx-node');
const files = JSON.parse(process.env.WEBR_VOICE_MODEL);

const recognizer = new OfflineRecognizer({
  featConfig: { sampleRate: 16000, featureDim: 80 },
  modelConfig: { transducer: { encoder: files.encoder, decoder: files.decoder, joiner: files.joiner }, tokens: files.tokens, modelType: 'nemo_transducer', numThreads: 4, provider: 'cpu', debug: 0 },
});

function transcribe({ samples, sampleRate }) {
  const stream = recognizer.createStream();
  stream.acceptWaveform({ samples, sampleRate });
  recognizer.decode(stream);
  return recognizer.getResult(stream).text.trim();
}

process.on('message', (request) => {
  try { process.send({ id: request.id, text: transcribe(request) }); }
  catch (error) { process.send({ id: request.id, error: error instanceof Error ? error.message : String(error) }); }
});
process.on('disconnect', () => process.exit(0));
process.send({ ready: true });
