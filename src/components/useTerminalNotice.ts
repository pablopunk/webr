import { useCallback, useEffect, useRef, useState } from 'react';

export type TerminalNotice = { text: string; tone: 'info' | 'error' };
export type ShowTerminalNotice = (text: string, tone: TerminalNotice['tone'], durationMs?: number) => void;

export function useTerminalNotice() {
  const [notice, setNotice] = useState<TerminalNotice | null>(null);
  const hide = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback<ShowTerminalNotice>((text, tone, durationMs) => {
    clearTimeout(hide.current); setNotice({ text, tone });
    if (durationMs) hide.current = setTimeout(() => setNotice(null), durationMs);
  }, []);
  useEffect(() => () => clearTimeout(hide.current), []);
  return { notice, show };
}
