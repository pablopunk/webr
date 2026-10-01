import { useEffect, useRef, useState } from 'react';
import type { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import type { Pane } from '../lib/models';
import { useRuntime } from '../client/provider';

function themeColors() {
  const styles = getComputedStyle(document.documentElement);
  return {
    background: styles.getPropertyValue('--terminal-bg').trim(),
    foreground: styles.getPropertyValue('--terminal-ink').trim(),
    cursor: styles.getPropertyValue('--terminal-cursor').trim(),
    selectionBackground: styles.getPropertyValue('--terminal-selection').trim(),
    black: '#222222', red: '#df7774', green: '#8ebea1', yellow: '#d4b581',
    blue: '#81aee0', magenta: '#ac9dd5', cyan: '#8dc6cf', white: '#d5d5d5',
    brightBlack: '#777777', brightRed: '#f18f89', brightGreen: '#a1d8b6',
    brightYellow: '#eed1a2', brightBlue: '#a7c7ef', brightMagenta: '#c6b6e8',
    brightCyan: '#abdee4', brightWhite: '#ffffff',
  };
}

export function TerminalPane({ pane, machineId, threadId, active, onFocus }: { pane: Pane; machineId: string; threadId: string; active: boolean; onFocus: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const control = useRef<ReturnType<ReturnType<typeof useRuntime>['terminals']['mount']> | null>(null);
  const { terminals } = useRuntime();
  const [message, setMessage] = useState('Connecting…');
  const [writable, setWritable] = useState(false);
  const [draft, setDraft] = useState('');
  const composing = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!host.current) return;
    let disposed = false;
    let cleanup = () => {};
    void import('@xterm/xterm').then((xterm) => {
    if (disposed || !host.current) return;
    const terminal = new xterm.Terminal({
      fontFamily: '"DM Mono", ui-monospace, monospace', fontSize: 12.5,
      lineHeight: 1.55, letterSpacing: 0.15, cursorBlink: true,
      allowTransparency: false, scrollback: 0, theme: themeColors(), disableStdin: true,
      linkHandler: { activate: () => {} },
    });
    terminal.open(host.current);
    term.current = terminal;
    const clipboard = terminal.parser.registerOscHandler(52, () => true);
    const links = terminal.parser.registerOscHandler(8, () => true);
    if (!pane.terminalId) { terminal.dispose(); return; }
    const viewport = () => ({ cols: Math.max(2, Math.min(500, Math.floor((host.current?.clientWidth ?? 640) / 8))), rows: Math.max(1, Math.min(300, Math.floor((host.current?.clientHeight ?? 400) / 20))) });
    control.current = terminals.mount({ machineId, threadId, terminalId: pane.terminalId, terminal, mode: 'observe', ...viewport(), onState: (message, writable) => { setMessage(message); setWritable(writable); if (!writable) setDraft(''); } });
    let timer: ReturnType<typeof setTimeout>;
    const resize = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => { const { cols, rows } = viewport(); control.current?.resize(cols, rows); }, 150);
    });
    resize.observe(host.current);
    const colorObserver = new MutationObserver(() => { terminal.options.theme = themeColors(); });
    colorObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    cleanup = () => {
      clearTimeout(timer); control.current?.close(); control.current = null;
      clipboard.dispose(); links.dispose(); resize.disconnect(); colorObserver.disconnect();
      terminal.dispose(); term.current = null;
    };
    }).catch(() => setMessage('The terminal could not load.'));
    return () => { disposed = true; cleanup(); };
  }, [pane.id, pane.terminalId, machineId, threadId, terminals]);

  useEffect(() => { if (active && writable) input.current?.focus(); }, [active, writable]);

  return <section className={`terminal-pane ${active ? 'is-active' : ''}`} aria-label={`${pane.title} terminal`} onClick={onFocus}>
    <div className="terminal-controls"><span role="status">{message}</span>{!writable && <><button onClick={() => control.current?.control()}>Request control</button><button onClick={() => { if (confirm('Replace the active terminal controller?')) control.current?.control(true); }}>Take over</button></>}</div>
    <div ref={host} className="terminal-host" />
    {writable && <textarea ref={input} className="terminal-input-capture" value={draft} aria-label="Terminal input" rows={1}
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={(event) => { composing.current = false; control.current?.input(event.currentTarget.value); setDraft(''); event.currentTarget.value = ''; }}
      onChange={(event) => { if (composing.current) setDraft(event.target.value); else { if (event.target.value) control.current?.input(event.target.value); setDraft(''); } }}
      onPaste={(event) => { event.preventDefault(); control.current?.input(event.clipboardData.getData('text/plain'), true); }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || composing.current || event.metaKey) return;
        const keys: Record<string, string> = { Enter: '\r', Backspace: '\x7f', Tab: '\t', Escape: '\x1b', ArrowUp: '\x1b[A', ArrowDown: '\x1b[B', ArrowRight: '\x1b[C', ArrowLeft: '\x1b[D' };
        const bytes = event.ctrlKey && /^[a-z]$/i.test(event.key) ? String.fromCharCode(event.key.toUpperCase().charCodeAt(0) - 64) : keys[event.key];
        if (bytes) { event.preventDefault(); control.current?.input(bytes); }
      }} />}
  </section>;
}
