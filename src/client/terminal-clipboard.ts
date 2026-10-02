import type { Terminal } from '@xterm/xterm';

const OSC_CLIPBOARD = 52;
const OSC_52_CLIPBOARD_READ_REQUEST = '?';

export function decodeOsc52ClipboardWrite(data: string): string | undefined {
  const payload = data.slice(data.indexOf(';') + 1);
  if (!data.includes(';') || !payload || payload === OSC_52_CLIPBOARD_READ_REQUEST) return undefined;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(payload), (char) => char.charCodeAt(0))); } catch { return undefined; }
}

function copyThroughDocumentCopyEvent(text: string) {
  const fill = (event: ClipboardEvent) => { event.clipboardData?.setData('text/plain', text); event.preventDefault(); };
  document.addEventListener('copy', fill, true);
  try { return document.execCommand('copy'); } catch { return false; } finally { document.removeEventListener('copy', fill, true); }
}

export async function writeClipboardText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return copyThroughDocumentCopyEvent(text); }
}

const hasOwnTextSelection = (target: EventTarget | null) => {
  if ((target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) && target.selectionStart !== target.selectionEnd) return true;
  return !!document.getSelection()?.toString();
};

export function bindTerminalClipboard(host: HTMLElement, terminal: Terminal, canWriteFromTerminalOutput: () => boolean, onCopied: (copied: boolean) => void) {
  const copySelectionOnRelease = () => { if (terminal.hasSelection()) void writeClipboardText(terminal.getSelection()).then(onCopied); };
  const copySelectionOnShortcut = (event: ClipboardEvent) => {
    if (event.defaultPrevented || !terminal.hasSelection() || hasOwnTextSelection(event.target)) return;
    event.clipboardData?.setData('text/plain', terminal.getSelection()); event.preventDefault(); onCopied(true);
  };
  const osc52 = terminal.parser.registerOscHandler(OSC_CLIPBOARD, (data) => {
    const text = decodeOsc52ClipboardWrite(data);
    if (text !== undefined && canWriteFromTerminalOutput()) void writeClipboardText(text).then(onCopied);
    return true;
  });
  host.addEventListener('mouseup', copySelectionOnRelease); window.addEventListener('copy', copySelectionOnShortcut);
  return () => { osc52.dispose(); host.removeEventListener('mouseup', copySelectionOnRelease); window.removeEventListener('copy', copySelectionOnShortcut); };
}
