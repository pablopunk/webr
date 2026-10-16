type TraceFields = Record<string, unknown>;
const MAX_QUEUED = 300;
const FLUSH_MS = 1000;
let outbox: TraceFields[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;

export const describeNode = (node: unknown): string | null => {
  if (node instanceof Element) {
    const classes = String(node.className ?? '').split(' ').filter(Boolean).slice(0, 2).map((name) => '.' + name).join('');
    const label = node.getAttribute('aria-label');
    return `${node.tagName.toLowerCase()}${classes}${label ? `[${label}]` : ''}`;
  }
  if (typeof document !== 'undefined' && node === document) return 'document';
  if (typeof window !== 'undefined' && node === window) return 'window';
  return node == null ? null : Object.prototype.toString.call(node);
};
const callerFrames = () => (new Error().stack ?? '').split('\n').slice(3, 6).map((line) => line.trim().replace(/^at /, '')).join(' < ');

/** Queues one trace record; records reach ~/.webr/trace.log on the server about once a second. */
export function trace(event: string, fields: TraceFields = {}) {
  if (typeof document === 'undefined') return;
  outbox.push({ t: new Date().toISOString(), event, page: location.pathname, ...fields });
  if (outbox.length > MAX_QUEUED) outbox.splice(0, outbox.length - MAX_QUEUED);
  flushTimer ??= setTimeout(flushTrace, FLUSH_MS);
}
function flushTrace() {
  flushTimer = undefined;
  const records = outbox; outbox = [];
  if (!records.length) return;
  void fetch('/api/trace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ records }), keepalive: true }).catch(() => undefined);
}

const activeDescription = () => describeNode(document.activeElement);
const terminalPaneIsActive = () => !!document.querySelector('.terminal-pane.is-active');
const typedIntoTerminalInput = (event: KeyboardEvent) => event.target instanceof Element && event.target.classList.contains('terminal-input-capture');

/** Records every focus move on the page, who asked for it, and keys that land outside the active terminal. */
export function startFocusTrace() {
  const onFocusOut = (event: FocusEvent) => trace('focusout', { from: describeNode(event.target), to: describeNode(event.relatedTarget), fromConnected: event.target instanceof Node ? event.target.isConnected : undefined });
  const onFocusIn = (event: FocusEvent) => trace('focusin', { to: describeNode(event.target), from: describeNode(event.relatedTarget) });
  const onWindowBlur = () => trace('window.blur', { active: activeDescription() });
  const onWindowFocus = () => trace('window.focus', { active: activeDescription() });
  const onVisibility = () => trace('visibility', { state: document.visibilityState, active: activeDescription() });
  const onKeyDown = (event: KeyboardEvent) => { if (typedIntoTerminalInput(event) || !terminalPaneIsActive()) return; trace('key.astray', { key: event.key.length === 1 ? 'char' : event.key, target: describeNode(event.target), active: activeDescription() }); };
  document.addEventListener('focusout', onFocusOut, true); document.addEventListener('focusin', onFocusIn, true);
  window.addEventListener('blur', onWindowBlur); window.addEventListener('focus', onWindowFocus); document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('keydown', onKeyDown, true);
  const originalFocus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function tracedFocus(this: HTMLElement, options?: FocusOptions) { trace('focus.call', { target: describeNode(this), by: callerFrames() }); return originalFocus.call(this, options); };
  trace('trace.start', { active: activeDescription(), visible: document.visibilityState, hasFocus: document.hasFocus() });
  return () => {
    document.removeEventListener('focusout', onFocusOut, true); document.removeEventListener('focusin', onFocusIn, true);
    window.removeEventListener('blur', onWindowBlur); window.removeEventListener('focus', onWindowFocus); document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('keydown', onKeyDown, true);
    HTMLElement.prototype.focus = originalFocus;
  };
}
