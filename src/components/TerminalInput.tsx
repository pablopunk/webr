import { useRef, useState } from 'react';
const specialKeys: Record<string, string> = { Enter: '\r', Backspace: '\x7f', Tab: '\t', Escape: '\x1b', ArrowUp: '\x1b[A', ArrowDown: '\x1b[B', ArrowRight: '\x1b[C', ArrowLeft: '\x1b[D' };
export function terminalKeyBytes(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey'>): string | undefined {
  const bytes = event.ctrlKey && /^[a-z]$/i.test(event.key) ? String.fromCharCode(event.key.toUpperCase().charCodeAt(0) - 64) : specialKeys[event.key];
  return bytes && (event.altKey ? '\x1b' + bytes : bytes);
}
export function TerminalInput({ onInput }: { onInput: (text: string, paste?: boolean) => void }) {
  const [draft, setDraft] = useState('');
  const composing = useRef(false);
  const committed = useRef<string | null>(null);
  return <textarea className="terminal-input-capture" value={draft} aria-label="Terminal input" rows={1}
    onCompositionStart={() => { composing.current = true; committed.current = null; }}
    onCompositionEnd={(event) => { composing.current = false; const text = event.data; committed.current = text; if (text) onInput(text); setDraft(''); event.currentTarget.value = ''; }}
    onChange={(event) => {
      if (composing.current) { setDraft(event.target.value); return; }
      const text = event.target.value;
      if (text && text !== committed.current) onInput(text);
      committed.current = null; setDraft(''); event.currentTarget.value = '';
    }}
    onPaste={(event) => { event.preventDefault(); committed.current = null; const text = event.clipboardData.getData('text/plain'); if (text) onInput(text, true); }}
    onKeyDown={(event) => {
      if (event.defaultPrevented || event.nativeEvent.isComposing || composing.current || event.metaKey) return;
      committed.current = null;
      const bytes = terminalKeyBytes(event);
      if (bytes) { event.preventDefault(); onInput(bytes); }
    }} />;
}
