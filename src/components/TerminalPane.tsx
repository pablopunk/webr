import { confirmDialog } from './dialogs';
import { useEffect, useRef, useState } from 'react';
import type { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import type { Pane } from '../lib/models';
import { useRuntime } from '../client/provider';
import { TerminalInput, controlCharacter, terminalKeyBytes } from './TerminalInput';
import { TerminalKeyBar } from './TerminalKeyBar';
import { matchesCoarsePointer } from '../client/visual-viewport';
import { bindTerminalGestures } from '../client/terminal-gestures';
import { peekLeaderPrefix, shortcutInvolves, takeLeaderPrefix } from '../client/keyboard';
import { getShortcuts, keyCombo } from './shortcuts';
import { conflictMessage } from '../client/terminal-manager';
import { ImagePlus } from 'lucide-react';
import { useImageAttachments } from './useImageAttachments';
import { imageFilesFrom } from '../client/image-attach';
import { openLinkUnderModifierClick, urlFromSelectedCells } from '../client/terminal-links';
import { TerminalUrlActions, type SelectedUrl } from './TerminalUrlActions';
import { bindTerminalClipboard, type CopyOutcome } from '../client/terminal-clipboard';
import { useTerminalNotice } from './useTerminalNotice';
import { useVoiceInput } from './useVoiceInput';
import { terminalStartupCommands, type TerminalStartupPreset } from '../client/terminal-presets';
import { isNarrowScreen } from '../client/pane-window';
import { focusRestsNowhere, textIsSelectedOutsideTerminal } from '../client/focus-ownership';
import { describeNode, trace } from '../client/trace';

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

const TERMINAL_FONT_FAMILY = '"JetBrains Mono", "Webr Symbols", ui-monospace, Menlo, monospace';
const TERMINAL_FONT_SIZE = 15;
const NARROW_TERMINAL_FONT_SIZE = 12;
const terminalFontSize = () => isNarrowScreen() ? NARROW_TERMINAL_FONT_SIZE : TERMINAL_FONT_SIZE;
const loadTerminalFonts = () => typeof document === 'undefined' || !document.fonts ? Promise.resolve() : Promise.all([
  document.fonts.load(`400 ${TERMINAL_FONT_SIZE}px "JetBrains Mono"`), document.fonts.load(`700 ${TERMINAL_FONT_SIZE}px "JetBrains Mono"`), document.fonts.load(`${TERMINAL_FONT_SIZE}px "Webr Symbols"`, '\ue0b0'),
]).then(() => undefined, () => undefined);
const FOCUS_IN = '\x1b[I';
const FOCUS_OUT = '\x1b[O';
const finiteSize = (size: { cols: number; rows: number } | undefined) => size && Number.isFinite(size.cols) && Number.isFinite(size.rows) ? size : undefined;

function loadGlyphRenderer(terminal: Terminal, create: () => { onContextLoss(listener: () => void): unknown; dispose(): void }) {
  try { const renderer = create(); renderer.onContextLoss(() => renderer.dispose()); terminal.loadAddon(renderer as never); } catch { /* DOM renderer stays active */ }
}

export function TerminalPane({ pane, machineId, threadId, tabId, active, canControl, connected = true, onFocus, startupPreset, onStartupComplete }: { pane: Pane; machineId: string; threadId?: string; tabId?: string; active: boolean; canControl: boolean; connected?: boolean; onFocus: () => void; startupPreset?: TerminalStartupPreset; onStartupComplete?: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const section = useRef<HTMLElement>(null);
  const term = useRef<Terminal | null>(null);
  const control = useRef<ReturnType<ReturnType<typeof useRuntime>['terminals']['mount']> | null>(null);
  const { terminals } = useRuntime();
  const [message, setMessage] = useState('Connecting…');
  const [writable, setWritable] = useState(false);
  const writableRef = useRef(false);
  const [typeable, setTypeable] = useState(false);
  const typeableRef = useRef(false);
  const canControlRef = useRef(canControl); canControlRef.current = canControl;
  const connectedRef = useRef(connected); connectedRef.current = connected;
  const activeRef = useRef(active); activeRef.current = active;
  const pendingFocus = useRef(active);
  const startupSent = useRef(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [ctrl, setCtrl] = useState(false);
  const [touch, setTouch] = useState(false);
  const [selectedUrl, setSelectedUrl] = useState<SelectedUrl | null>(null);
  useEffect(() => setTouch(matchesCoarsePointer()), []);
  const { notice, show } = useTerminalNotice();
  const images = useImageAttachments({ machineId, active, writable: writableRef, show, send: (text) => { control.current?.input(text, true); } });
  const voice = useVoiceInput({ show, send: (text) => { control.current?.input(text, true); } });
  const showCopyResult = useRef((outcome: CopyOutcome) => {}); showCopyResult.current = (outcome) => outcome === 'copied' ? show('Copied to clipboard', 'info', 1200) : outcome === 'waiting-for-click' ? show('Click or press a key to finish copying.', 'info', 6000) : show('The browser blocked clipboard access.', 'error', 4000);

  useEffect(() => {
    if (!startupPreset || startupSent.current) return;
    if (!connected) { startupSent.current = true; onStartupComplete?.(); return; }
    if (!writable) return;
    startupSent.current = true;
    control.current?.input(`${terminalStartupCommands[startupPreset]}\r`);
    onStartupComplete?.();
  }, [startupPreset, writable, connected, onStartupComplete]);

  useEffect(() => {
    if (!host.current) return;
    let disposed = false;
    let cleanup = () => {};
    void Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit'), import('@xterm/addon-web-links'), import('@xterm/addon-webgl'), loadTerminalFonts()]).then(([xterm, { FitAddon }, { WebLinksAddon }, { WebglAddon }]) => {
    if (disposed || !host.current) return;
    const terminal = new xterm.Terminal({
      fontFamily: TERMINAL_FONT_FAMILY, fontSize: terminalFontSize(),
      lineHeight: 1.2, letterSpacing: 0, cursorBlink: true, cursorInactiveStyle: 'block',
      allowTransparency: false, scrollback: 0, theme: themeColors(), disableStdin: true,
      linkHandler: { activate: () => {} },
    });
    terminal.open(host.current);
    loadGlyphRenderer(terminal, () => new WebglAddon());
    terminal.attachCustomWheelEventHandler(() => false);
    term.current = terminal;
    const redirectFocus = () => { if (activeRef.current && typeableRef.current) section.current?.querySelector<HTMLTextAreaElement>('.terminal-input-capture')?.focus({ preventScroll: true }); };
    terminal.textarea?.addEventListener('focus', redirectFocus);
    const clipboard = bindTerminalClipboard(host.current, terminal, () => writableRef.current, (outcome) => showCopyResult.current(outcome));
    const links = terminal.parser.registerOscHandler(8, () => true);
    if (!pane.terminalId) { clipboard(); terminal.dispose(); return; }
    const fit = new FitAddon(); terminal.loadAddon(fit);
    terminal.loadAddon(new WebLinksAddon(() => {}));
    const openLink = (event: MouseEvent) => openLinkUnderModifierClick(terminal, event);
    const hostElement = host.current; hostElement.addEventListener('mouseup', openLink);
    const offerSelectedUrl = (event: MouseEvent) => {
      const url = terminal.hasSelection() ? urlFromSelectedCells(terminal) : undefined;
      const origin = section.current?.getBoundingClientRect();
      setSelectedUrl(url && origin ? { url, x: event.clientX - origin.left, y: event.clientY - origin.top } : null);
    };
    const withdrawUrlOffer = () => { if (!terminal.hasSelection()) setSelectedUrl(null); };
    hostElement.addEventListener('mouseup', offerSelectedUrl); const selection = terminal.onSelectionChange(withdrawUrlOffer);
    const estimatedViewport = () => ({ cols: Math.floor((host.current?.clientWidth ?? 640) / 8), rows: Math.floor((host.current?.clientHeight ?? 400) / 20) });
    const measuredViewport = () => { try { return finiteSize(fit.proposeDimensions()); } catch { return undefined; } };
    const hostIsLaidOut = () => !!host.current?.isConnected && host.current.clientWidth > 0 && host.current.clientHeight > 0;
    const viewport = () => { const { cols, rows } = measuredViewport() ?? estimatedViewport(); return { cols: Math.max(2, Math.min(500, cols)), rows: Math.max(1, Math.min(300, rows)) }; };
    control.current = terminals.mount({ machineId, ...(threadId ? { threadId } : { tabId }), terminalId: pane.terminalId, terminal, mode: canControlRef.current && connectedRef.current ? 'control' : 'observe', ...viewport(), onState: (message, writable, typeable = writable) => {
      trace('pane.state', { pane: pane.id, terminalId: pane.terminalId, message, writable, typeable, active: activeRef.current });
      setMessage(message); setWritable(writable); writableRef.current = writable; setTypeable(typeable); typeableRef.current = typeable;
    } });
    const gestures = bindTerminalGestures(host.current, () => ({ element: terminal.element?.querySelector<HTMLElement>('.xterm-screen') ?? undefined, cols: terminal.cols, rows: terminal.rows }), () => control.current, () => writableRef.current);
    let timer: ReturnType<typeof setTimeout>;
    const resize = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => { if (!hostIsLaidOut()) return; const { cols, rows } = viewport(); control.current?.resize(cols, rows); }, 150);
    });
    resize.observe(host.current);
    const claimSize = () => { if (document.visibilityState !== 'visible' || !document.hasFocus() || !hostIsLaidOut()) return; const { cols, rows } = viewport(); control.current?.resize(cols, rows, true); };
    window.addEventListener('focus', claimSize); document.addEventListener('visibilitychange', claimSize);
    const colorObserver = new MutationObserver(() => { terminal.options.theme = themeColors(); });
    colorObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    cleanup = () => {
      clearTimeout(timer); control.current?.close(); control.current = null;
      writableRef.current = false; gestures();
      window.removeEventListener('focus', claimSize); document.removeEventListener('visibilitychange', claimSize);
      terminal.textarea?.removeEventListener('focus', redirectFocus);
      clipboard(); hostElement.removeEventListener('mouseup', openLink); hostElement.removeEventListener('mouseup', offerSelectedUrl); selection.dispose(); setSelectedUrl(null); links.dispose(); resize.disconnect(); colorObserver.disconnect();
      terminal.dispose(); term.current = null;
    };
    }).catch(() => setMessage('The terminal could not load.'));
    return () => { disposed = true; cleanup(); };
  }, [pane.id, pane.terminalId, machineId, threadId, tabId, terminals]);


  const sendInput = (text: string, paste?: boolean) => {
    if (!activeRef.current || !connectedRef.current || !typeableRef.current) return;
    if (!ctrl || paste) { control.current?.input(text, paste); return; }
    setCtrl(false);
    control.current?.input(controlCharacter(text) ?? text);
  };
  // xterm is a renderer, not our input owner. Focusing its helper first creates
  // a second focus/blur cycle and can reactivate the pane we just left.
  const whyFocusIsBlocked = (preserveSelection: boolean) => !activeRef.current ? 'inactive' : !connectedRef.current ? 'disconnected' : !typeableRef.current ? 'not typeable'
    : preserveSelection && term.current?.hasSelection() ? 'selection' : document.querySelector('[role="dialog"], [role="alertdialog"]') ? 'dialog' : undefined;
  const focusInput = (preserveSelection = true) => {
    const blocked = whyFocusIsBlocked(preserveSelection);
    if (blocked) { if (blocked !== 'inactive') trace('pane.focus.skip', { pane: pane.id, reason: blocked }); return; }
    const input = section.current?.querySelector<HTMLTextAreaElement>('.terminal-input-capture');
    input?.focus({ preventScroll: true });
    const focused = !!input && document.activeElement === input;
    if (focused) pendingFocus.current = false;
    trace('pane.focus.claim', { pane: pane.id, focused, sendFocusMode: term.current?.modes.sendFocusMode, before: describeNode(document.activeElement) });
  };
  useEffect(() => { trace('pane.active', { pane: pane.id, terminalId: pane.terminalId, active, typeable: typeableRef.current }); pendingFocus.current = active; if (active) focusInput(false); }, [active]);
  useEffect(() => {
    const focused = document.activeElement;
    // Readiness is not a navigation request: don't steal focus from a search,
    // palette, or editor when a resized baseline arrives.
    if (active && typeable && (pendingFocus.current || focused === document.body || section.current?.contains(focused))) focusInput(false);
  }, [active, typeable]);
  const pointerIsDown = useRef(false);
  useEffect(() => {
    const pressed = () => { pointerIsDown.current = true; };
    const released = () => { pointerIsDown.current = false; };
    document.addEventListener('pointerdown', pressed, true); document.addEventListener('pointerup', released, true); document.addEventListener('pointercancel', released, true);
    return () => { document.removeEventListener('pointerdown', pressed, true); document.removeEventListener('pointerup', released, true); document.removeEventListener('pointercancel', released, true); };
  }, []);
  const focusDroppedWithNothingBetterToDo = () => focusRestsNowhere() && !pointerIsDown.current && !textIsSelectedOutsideTerminal();
  useEffect(() => { if (active && typeable && focusDroppedWithNothingBetterToDo()) focusInput(false); });
  useEffect(() => {
    if (!active || !typeable) return;
    let frame = 0; let reclaimOnRelease = false;
    const reclaim = () => { if (pointerIsDown.current) { reclaimOnRelease = true; return; } if (focusDroppedWithNothingBetterToDo()) focusInput(false); };
    const reclaimFocusDroppedOnBody = (event: FocusEvent) => {
      if (event.relatedTarget) return;
      cancelAnimationFrame(frame); frame = requestAnimationFrame(reclaim);
    };
    const reclaimAfterPointerRelease = () => { if (!reclaimOnRelease) return; reclaimOnRelease = false; cancelAnimationFrame(frame); frame = requestAnimationFrame(reclaim); };
    document.addEventListener('focusout', reclaimFocusDroppedOnBody);
    document.addEventListener('pointerup', reclaimAfterPointerRelease); document.addEventListener('pointercancel', reclaimAfterPointerRelease);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('focusout', reclaimFocusDroppedOnBody); document.removeEventListener('pointerup', reclaimAfterPointerRelease); document.removeEventListener('pointercancel', reclaimAfterPointerRelease); };
  }, [active, typeable]);
  useEffect(() => { if (term.current) term.current.options.cursorInactiveStyle = active ? 'block' : 'outline'; }, [active, writable]);
  useEffect(() => {
    if (!active || !typeable) return;
    const unfocused = (event: Event) => event.target === document.body || event.target === document.documentElement || section.current?.contains(event.target as Node);
    const onKeyDown = (event: KeyboardEvent) => {
      if (!activeRef.current || !connectedRef.current || !typeableRef.current) return;
      const fromInput = (event.target as HTMLElement).classList?.contains('terminal-input-capture');
      const ownInput = fromInput && section.current?.contains(event.target as Node);
      if (event.defaultPrevented || event.metaKey || event.isComposing || !unfocused(event) && !fromInput || ownInput) return;
      // Herdr-style app shortcuts (including the prefix starter) belong to the
      // app leader-key handler even when a terminal pane has focus.
      // A doubled prefix is the exception: it sends one literal prefix to
      // the shell, so consume the armed state and fall through to bytes.
      // This handler runs before the app's, hence peek-then-take here.
      const combo = keyCombo(event);
      if (combo && peekLeaderPrefix() === combo) takeLeaderPrefix();
      else if (shortcutInvolves(combo, getShortcuts())) return;
      const bytes = terminalKeyBytes(event);
      if (bytes) { event.preventDefault(); event.stopPropagation(); focusInput(false); control.current?.input(bytes); } else if (event.key.length === 1 && !event.ctrlKey && !event.altKey) {
        event.preventDefault(); event.stopPropagation(); focusInput(false); control.current?.input(event.key);
      }
    };
    const onPaste = (event: ClipboardEvent) => {
      if (!activeRef.current || !connectedRef.current || !typeableRef.current) return;
      const fromInput = (event.target as HTMLElement).classList?.contains('terminal-input-capture');
      if (!unfocused(event) && !fromInput) return;
      const pastedImages = imageFilesFrom(event.clipboardData);
      if (pastedImages.length) { event.preventDefault(); event.stopPropagation(); void images.attach(pastedImages); return; }
      const text = event.clipboardData?.getData('text/plain');
      if (!text || fromInput && section.current?.contains(event.target as Node)) return;
      event.preventDefault(); event.stopPropagation(); control.current?.input(text, true);
    };
    window.addEventListener('keydown', onKeyDown, true); window.addEventListener('paste', onPaste, true);
    return () => { window.removeEventListener('keydown', onKeyDown, true); window.removeEventListener('paste', onPaste, true); };
  }, [active, typeable, images.attach]);
  useEffect(() => {
    const refocus = () => {
      const focused = document.activeElement;
      if (active && (focused === document.body || section.current?.contains(focused))) focusInput(false);
    };
    window.addEventListener('focus', refocus);
    return () => window.removeEventListener('focus', refocus);
  }, [active, typeable]);
  const inputPaused = active && connected && canControl && !typeable;
  const [showInputPaused, setShowInputPaused] = useState(false);
  useEffect(() => {
    if (!inputPaused) { setShowInputPaused(false); return; }
    const timer = setTimeout(() => setShowInputPaused(true), 400);
    return () => clearTimeout(timer);
  }, [inputPaused]);
  // Herdr's baseline never replays the focus-reporting mode, so xterm cannot
  // know an agent asked for it; agents (Ink, crossterm, Bubble Tea) parse
  // CSI I / CSI O regardless, while a shell would echo them, hence the gate.
  const appWantsFocusReports = () => !!term.current?.modes.sendFocusMode || pane.kind === 'agent';
  const reportInputFocus = (focused: boolean) => {
    setInputFocused(focused);
    const reported = appWantsFocusReports();
    trace('pane.input.focus', { pane: pane.id, focused, reported, typeable: typeableRef.current });
    if (reported) control.current?.input(focused ? FOCUS_IN : FOCUS_OUT);
  };

  return <section ref={section} className={`terminal-pane ${active ? 'is-active' : ''}`} aria-label={`${pane.title} terminal`} onPointerDownCapture={() => { if (!active) onFocus(); }} onFocusCapture={() => { if (!active) onFocus(); }} onClick={() => { if (canControlRef.current && connectedRef.current && !writableRef.current) control.current?.control(); focusInput(); }}>
    <span className="terminal-status" role="status">{message}</span>
    {showInputPaused && message !== conflictMessage && <div className="terminal-input-paused" aria-hidden="true">Input paused: {message}</div>}
    {message === conflictMessage && <div className="terminal-control-conflict">Another Herdr client controls this terminal.<button type="button" onClick={(event) => { event.stopPropagation(); void confirmDialog('Replace the other Herdr client that controls this terminal? Its input stops working.', { confirmLabel: 'Take over' }).then((accepted) => { if (accepted) control.current?.control(true); }); }}>Take over</button></div>}
    <div ref={host} className="terminal-host" />
    {images.dragging && <div className="terminal-drop-overlay" aria-hidden="true"><ImagePlus size={22} strokeWidth={1.6} /><span>Drop image to attach</span></div>}
    {selectedUrl && <TerminalUrlActions selected={selectedUrl} onDone={() => { setSelectedUrl(null); term.current?.clearSelection(); }} onCopied={(copied) => showCopyResult.current(copied ? 'copied' : 'blocked')} />}
    {notice && <div className={`terminal-attach-notice is-${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}</div>}
    <TerminalInput active={active} readOnly={!typeable || !connected} onInput={sendInput} onFocusChange={reportInputFocus} />
    {connected && (canControl || writable) && active && touch && inputFocused && <TerminalKeyBar ctrl={ctrl} onToggleCtrl={() => setCtrl((armed) => !armed)} onBytes={(bytes) => control.current?.input(bytes)} voice={voice} />}
  </section>;
}
