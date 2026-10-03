import { useCallback, useEffect, useRef, useState } from 'react';
import { canRecordAudio, startRecording, type Recorder } from '../client/voice-recorder';
import { transcribe, voiceState, warmVoice, type VoiceState } from '../client/voice';
import type { ShowTerminalNotice } from './useTerminalNotice';

export type VoicePhase = 'idle' | 'preparing' | 'recording' | 'transcribing';

const DOWNLOAD_POLL_MS = 2000;
const DOWNLOADING = 'Downloading the voice model (670 MB, one time). The mic works when it finishes.';
const isDownloadPending = (state: VoiceState) => state === 'needs-download' || state === 'downloading';
const microphoneError = (error: unknown) => error instanceof DOMException && error.name === 'NotAllowedError' ? 'Allow microphone access for Webr in your browser settings.' : 'The microphone could not start.';

export function useVoiceInput({ send, show }: { send: (text: string) => void; show: ShowTerminalNotice }) {
  const [state, setState] = useState<VoiceState>('unavailable');
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const recorder = useRef<Recorder>(undefined);
  const sendRef = useRef(send); sendRef.current = send;

  useEffect(() => {
    if (!canRecordAudio()) return;
    let cancelled = false;
    void voiceState().then((current) => { if (!cancelled) setState(current); });
    return () => { cancelled = true; recorder.current?.cancel(); };
  }, []);

  useEffect(() => {
    if (phase !== 'preparing') return;
    const poll = setInterval(() => void voiceState().then((current) => {
      if (isDownloadPending(current)) return;
      setState(current); setPhase('idle');
      show(current === 'ready' ? 'Voice input is ready. Tap the mic to talk.' : 'The voice model could not be downloaded.', current === 'ready' ? 'info' : 'error', 4000);
    }), DOWNLOAD_POLL_MS);
    return () => clearInterval(poll);
  }, [phase, show]);

  const prepare = useCallback(() => { void warmVoice(); setPhase('preparing'); show(DOWNLOADING, 'info'); }, [show]);

  const record = useCallback(async () => {
    setPhase('recording');
    const starting = startRecording();
    void warmVoice();
    try { recorder.current = await starting; }
    catch (error) { setPhase('idle'); show(microphoneError(error), 'error', 5000); }
  }, [show]);

  const finish = useCallback(async () => {
    const active = recorder.current; recorder.current = undefined;
    if (!active) return;
    setPhase('transcribing');
    try {
      const { pcm, sampleRate } = await active.stop();
      const text = await transcribe(pcm, sampleRate);
      if (text) sendRef.current(text); else show('No speech was heard.', 'info', 2500);
    } catch (error) { show(error instanceof Error ? error.message : 'The recording could not be transcribed.', 'error', 5000); }
    finally { setPhase('idle'); }
  }, [show]);

  const toggle = useCallback(() => {
    if (phase === 'idle') { if (isDownloadPending(state)) prepare(); else void record(); }
    else if (phase === 'recording') void finish();
  }, [phase, state, prepare, record, finish]);

  return { available: state !== 'unavailable', phase, toggle };
}
