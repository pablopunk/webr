import type { Terminal } from '@xterm/xterm';

const URL_PATTERN = /https?:\/\/[^\s"'<>`]+/g;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/;

const hasOpenModifier = (event: MouseEvent) => event.metaKey || event.ctrlKey;

function logicalLineAt(terminal: Terminal, row: number) {
  const buffer = terminal.buffer.active;
  let first = row;
  while (first > 0 && buffer.getLine(first)?.isWrapped) first--;
  let text = ''; let last = first;
  for (let index = first; buffer.getLine(index) && (index === first || buffer.getLine(index)!.isWrapped); index++) { text += buffer.getLine(index)!.translateToString(false, 0, terminal.cols); last = index; }
  return { text, offset: (row - first) * terminal.cols, last };
}

export function urlAtCell(terminal: Terminal, column: number, row: number) {
  const { text, offset } = logicalLineAt(terminal, row);
  const position = offset + column;
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = match[0].replace(TRAILING_PUNCTUATION, '');
    if (position >= match.index && position < match.index + url.length) return url;
  }
  return undefined;
}

const trimmedLines = (text: string) => text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
const WHOLE_URL = /^https?:\/\/[^\s"'<>`]+$/;

export function urlFromSelection(selection: string) {
  const joined = trimmedLines(selection).join('').replace(TRAILING_PUNCTUATION, '');
  return WHOLE_URL.test(joined) ? joined : undefined;
}

export const openUrlInNewTab = (url: string) => { window.open(url, '_blank', 'noopener,noreferrer'); };

export function openLinkUnderModifierClick(terminal: Terminal, event: MouseEvent) {
  const screen = terminal.element?.querySelector<HTMLElement>('.xterm-screen'); const rect = screen?.getBoundingClientRect();
  if (!hasOpenModifier(event) || !rect?.width || !rect.height) return;
  const column = Math.floor((event.clientX - rect.left) / rect.width * terminal.cols);
  const row = Math.floor((event.clientY - rect.top) / rect.height * terminal.rows) + terminal.buffer.active.viewportY;
  const url = urlAtCell(terminal, column, row);
  if (url) openUrlInNewTab(url);
}
