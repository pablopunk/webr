import { useEffect, useRef } from 'react';
import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';
import { Bot, TerminalSquare } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';
import type { Pane } from '../lib/models';

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

export function TerminalPane({ pane, active, onFocus }: { pane: Pane; active: boolean; onFocus: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const fit = useRef<FitAddon | null>(null);
  const term = useRef<Terminal | null>(null);

  useEffect(() => {
    if (!host.current) return;
    let disposed = false;
    let cleanup = () => {};
    void Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')]).then(([xterm, fitModule]) => {
    if (disposed || !host.current) return;
    const terminal = new xterm.Terminal({
      fontFamily: '"DM Mono", ui-monospace, monospace', fontSize: 12.5,
      lineHeight: 1.55, letterSpacing: 0.15, cursorBlink: true,
      allowTransparency: false, scrollback: 1500, theme: themeColors(),
    });
    const addon = new fitModule.FitAddon();
    terminal.loadAddon(addon);
    terminal.open(host.current);
    fit.current = addon;
    term.current = terminal;
    const lines = pane.lines.map((line) => line.replace(/\x1b/g, '')).join('\r\n');
    terminal.write(lines);
    let buffer = '';
    const input = terminal.onData((data) => {
      if (data === '\r') {
        terminal.write('\r\n');
        const command = buffer.trim();
        buffer = '';
        if (command) {
          terminal.writeln('\x1b[90mDemo terminal — no command was run. Herdr will connect here later.\x1b[0m');
        }
        terminal.write('$ ');
      } else if (data === '\u007f') {
        if (buffer) { buffer = buffer.slice(0, -1); terminal.write('\b \b'); }
      } else if (data === '\u0003') {
        buffer = '';
        terminal.write('^C\r\n$ ');
      } else if (!data.startsWith('\x1b')) {
        buffer += data;
        terminal.write(data);
      }
    });
    const resize = new ResizeObserver(() => {
      try { addon.fit(); } catch { /* The host can be hidden during navigation. */ }
    });
    resize.observe(host.current);
    requestAnimationFrame(() => addon.fit());
    const colorObserver = new MutationObserver(() => { terminal.options.theme = themeColors(); });
    colorObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    cleanup = () => {
      input.dispose(); resize.disconnect(); colorObserver.disconnect();
      terminal.dispose(); term.current = null; fit.current = null;
    };
    }).catch((error) => console.error('Could not load terminal preview', error));
    return () => { disposed = true; cleanup(); };
  }, [pane.id]);

  useEffect(() => { if (active) term.current?.focus(); }, [active]);

  return <section className={`terminal-pane ${active ? 'is-active' : ''}`} aria-label={`${pane.title} terminal`} onClick={onFocus}>
    <header className="pane-header">
      <span className="pane-heading"><span className="pane-type-icon">{pane.kind === 'agent' ? <Bot size={14} /> : <TerminalSquare size={14} />}</span>{pane.title}</span>
      <span className="pane-header-actions"><span className="pane-id">{pane.id}</span></span>
    </header>
    <div ref={host} className="terminal-host" />
    <div className="pane-bottom"><span className="pane-live-dot" /> <span>Interactive preview</span><span className="pane-dimensions">{active ? 'Focused' : 'Click to focus'}</span></div>
  </section>;
}
