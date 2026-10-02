import { useEffect, useRef, useState } from 'react';
import type { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import type { Pane } from '../lib/models';
import { useRuntime } from '../client/provider';
import { TerminalInput, terminalKeyBytes } from './TerminalInput';
import { bindTerminalGestures } from '../client/terminal-gestures';
import { conflictMessage } from '../client/terminal-manager';

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

const FOCUS_IN = '\x1b[I';
const FOCUS_OUT = '\x1b[O';
export function TerminalPane({ pane, machineId, threadId, active, canControl, onFocus }: { pane: Pane; machineId: string; threadId: string; active: boolean; canControl: boolean; onFocus: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const section = useRef<HTMLElement>(null);
  const term = useRef<Terminal | null>(null);
  const control = useRef<ReturnType<ReturnType<typeof useRuntime>['terminals']['mount']> | null>(null);
  const { terminals } = useRuntime();
  const [message, setMessage] = useState('Connecting…');
  const [writable, setWritable] = useState(false);
  const writableRef = useRef(false);

  useEffect(() => {
    if (!host.current) return;
    let disposed = false;
    let cleanup = () => {};
    void Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')]).then(([xterm, { FitAddon }]) => {
    if (disposed || !host.current) return;
    const terminal = new xterm.Terminal({
      fontFamily: '"DM Mono", ui-monospace, monospace', fontSize: 12.5,
      lineHeight: 1.55, letterSpacing: 0.15, cursorBlink: true, cursorInactiveStyle: 'block',
      allowTransparency: false, scrollback: 0, theme: themeColors(), disableStdin: true,
      linkHandler: { activate: () => {} },
    });
    terminal.open(host.current);
    term.current = terminal;
    const redirectFocus = () => { if (writableRef.current) host.current?.parentElement?.querySelector<HTMLTextAreaElement>('.terminal-input-capture')?.focus(); };
    terminal.textarea?.addEventListener('focus', redirectFocus);
    const clipboard = terminal.parser.registerOscHandler(52, () => true);
    const links = terminal.parser.registerOscHandler(8, () => true);
    if (!pane.terminalId) { terminal.dispose(); return; }
    const fit = new FitAddon(); terminal.loadAddon(fit);
    const estimatedViewport = () => ({ cols: Math.floor((host.current?.clientWidth ?? 640) / 8), rows: Math.floor((host.current?.clientHeight ?? 400) / 20) });
    const measuredViewport = () => { try { return fit.proposeDimensions(); } catch { return undefined; } };
    const viewport = () => { const { cols, rows } = measuredViewport() ?? estimatedViewport(); return { cols: Math.max(2, Math.min(500, cols)), rows: Math.max(1, Math.min(300, rows)) }; };
    control.current = terminals.mount({ machineId, threadId, terminalId: pane.terminalId, terminal, mode: canControl && active ? 'control' : 'observe', ...viewport(), onState: (message, writable) => { setMessage(message); setWritable(writable); writableRef.current = writable; } });
    const gestures = bindTerminalGestures(host.current, () => ({ element: terminal.element?.querySelector<HTMLElement>('.xterm-screen') ?? undefined, cols: terminal.cols, rows: terminal.rows }), () => control.current, () => writableRef.current);
    let timer: ReturnType<typeof setTimeout>;
    const resize = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => { const { cols, rows } = viewport(); control.current?.resize(cols, rows); }, 150);
    });
    resize.observe(host.current);
    const claimSize = () => { if (document.visibilityState !== 'visible' || !document.hasFocus()) return; const { cols, rows } = viewport(); control.current?.resize(cols, rows, true); };
    window.addEventListener('focus', claimSize); document.addEventListener('visibilitychange', claimSize);
    const colorObserver = new MutationObserver(() => { terminal.options.theme = themeColors(); });
    colorObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    cleanup = () => {
      clearTimeout(timer); control.current?.close(); control.current = null;
      writableRef.current = false; gestures();
      window.removeEventListener('focus', claimSize); document.removeEventListener('visibilitychange', claimSize);
      terminal.textarea?.removeEventListener('focus', redirectFocus);
      clipboard.dispose(); links.dispose(); resize.disconnect(); colorObserver.disconnect();
      terminal.dispose(); term.current = null;
    };
    }).catch(() => setMessage('The terminal could not load.'));
    return () => { disposed = true; cleanup(); };
  }, [pane.id, pane.terminalId, machineId, threadId, terminals, canControl]);

  useEffect(() => { if (canControl) { if (active) control.current?.control(); else control.current?.observe(); } }, [active, canControl]);

  const focusInput = () => { if (writable && !term.current?.hasSelection()) host.current?.parentElement?.querySelector<HTMLTextAreaElement>('.terminal-input-capture')?.focus(); };
  useEffect(() => { if (active) focusInput(); }, [active, writable]);
  useEffect(() => {
    if (!active || !writable) return;
    const unfocused = (event: Event) => event.target === document.body || event.target === document.documentElement || section.current?.contains(event.target as Node);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.isComposing || !unfocused(event) || (event.target as HTMLElement).classList?.contains('terminal-input-capture')) return;
      const bytes = terminalKeyBytes(event);
      if (bytes) { event.preventDefault(); event.stopPropagation(); control.current?.input(bytes); } else if (event.key.length === 1 && !event.ctrlKey) focusInput();
    };
    const onPaste = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData('text/plain');
      if (!text || !unfocused(event) || (event.target as HTMLElement).classList?.contains('terminal-input-capture')) return;
      event.preventDefault(); event.stopPropagation(); control.current?.input(text, true);
    };
    window.addEventListener('keydown', onKeyDown, true); window.addEventListener('paste', onPaste, true);
    return () => { window.removeEventListener('keydown', onKeyDown, true); window.removeEventListener('paste', onPaste, true); };
  }, [active, writable]);
  useEffect(() => { const refocus = () => { if (active) focusInput(); }; window.addEventListener('focus', refocus); return () => window.removeEventListener('focus', refocus); }, [active, writable]);

  return <section ref={section} className={`terminal-pane ${active ? 'is-active' : ''}`} aria-label={`${pane.title} terminal`} onClick={() => { onFocus(); if (canControl && !writableRef.current) control.current?.control(); focusInput(); }}>
    <span className="terminal-status" role="status">{message}</span>
    {message === conflictMessage && <div className="terminal-control-conflict">Another Herdr client controls this terminal.<button type="button" onClick={(event) => { event.stopPropagation(); if (confirm('Replace the other Herdr client that controls this terminal? Its input stops working.')) control.current?.control(true); }}>Take over</button></div>}
    <div ref={host} className="terminal-host" />
    {writable && <TerminalInput onInput={(text, paste) => control.current?.input(text, paste)} onFocusChange={(focused) => { if (term.current?.modes.sendFocusMode) control.current?.input(focused ? FOCUS_IN : FOCUS_OUT); }} />}
  </section>;
}
