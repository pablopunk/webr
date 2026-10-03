const TARGET_SAMPLE_RATE = 16_000;
const CAPTURE_PROCESSOR = `registerProcessor('webr-capture', class extends AudioWorkletProcessor {
  process([input]) { if (input?.[0]) this.port.postMessage(input[0].slice()); return true; }
});`;

export type Recording = { pcm: ArrayBuffer; sampleRate: number };
export type Recorder = { stop: () => Promise<Recording>; cancel: () => void };

export const canRecordAudio = () => typeof window !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia && typeof AudioWorkletNode !== 'undefined';

const createAudioContext = () => { try { return new AudioContext({ sampleRate: TARGET_SAMPLE_RATE }); } catch { return new AudioContext(); } };

function toInt16Pcm(chunks: Float32Array[]) {
  const pcm = new Int16Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) for (const sample of chunk) pcm[offset++] = Math.max(-1, Math.min(1, sample)) * 0x7fff;
  return pcm.buffer;
}

async function loadCaptureProcessor(context: AudioContext) {
  const url = URL.createObjectURL(new Blob([CAPTURE_PROCESSOR], { type: 'text/javascript' }));
  try { await context.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
}

export async function startRecording(): Promise<Recorder> {
  const context = createAudioContext();
  void context.resume();
  const release = (stream?: MediaStream) => { stream?.getTracks().forEach((track) => track.stop()); void context.close(); };
  let stream: MediaStream | undefined;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    await loadCaptureProcessor(context);
    await context.resume();
  } catch (error) { release(stream); throw error; }
  const chunks: Float32Array[] = [];
  const source = context.createMediaStreamSource(stream);
  const capture = new AudioWorkletNode(context, 'webr-capture');
  capture.port.onmessage = (event: MessageEvent<Float32Array>) => chunks.push(event.data);
  source.connect(capture);
  const finish = () => { source.disconnect(); capture.disconnect(); release(stream); };
  return {
    stop: async () => { const sampleRate = context.sampleRate; finish(); return { pcm: toInt16Pcm(chunks), sampleRate }; },
    cancel: finish,
  };
}
