import { ExternalLink, Copy } from 'lucide-react';
import { openUrlInNewTab } from '../client/terminal-links';
import { writeClipboardText } from '../client/terminal-clipboard';

export type SelectedUrl = { url: string; x: number; y: number };

const keepSelection = (event: React.SyntheticEvent) => { event.preventDefault(); event.stopPropagation(); };

export function TerminalUrlActions({ selected, onDone, onCopied }: { selected: SelectedUrl; onDone: () => void; onCopied: (copied: boolean) => void }) {
  return <div className="terminal-url-actions" role="toolbar" aria-label="Selected link" style={{ left: selected.x, top: selected.y }} onMouseDown={keepSelection} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
    <button type="button" onClick={() => { openUrlInNewTab(selected.url); onDone(); }}><ExternalLink size={14} strokeWidth={1.8} />Open link</button>
    <button type="button" onClick={() => { void writeClipboardText(selected.url).then(onCopied); onDone(); }}><Copy size={14} strokeWidth={1.8} />Copy link</button>
  </div>;
}
