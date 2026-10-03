export type VoiceState = 'unavailable' | 'needs-download' | 'downloading' | 'ready';

const voiceErrors: Record<string, string> = {
  voice_unavailable: 'Voice input is not available on this Webr server.',
  image_too_large: 'The recording is too long.',
};

export async function voiceState(): Promise<VoiceState> {
  const response = await fetch('/api/voice').catch(() => undefined);
  return response?.ok ? (await response.json()).state : 'unavailable';
}

export async function warmVoice(): Promise<VoiceState> {
  const response = await fetch('/api/voice/warm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => undefined);
  return response?.ok ? (await response.json()).state : 'unavailable';
}

export async function transcribe(pcm: ArrayBuffer, sampleRate: number): Promise<string> {
  const response = await fetch(`/api/voice/transcribe?sampleRate=${sampleRate}`, { method: 'POST', headers: { 'Content-Type': 'audio/l16' }, body: pcm });
  const result = await response.json().catch(() => ({})) as { text?: string; error?: string };
  if (!response.ok || result.text === undefined) throw new Error(voiceErrors[result.error ?? ''] ?? 'The recording could not be transcribed.');
  return result.text;
}
