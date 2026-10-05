import type { Block, DemoThread } from './demo';

const SPINNER_GLYPHS = ['·', '✢', '✳', '✶', '✻', '✽'];
const TICKS_PER_SECOND = 4;
const START_SECONDS = 2;
const START_TOKENS = 131;
const TOKENS_PER_TICK = 23;

const rgb = (r: number, g: number, b: number, text: string) => `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`;
const orange = (text: string) => rgb(217, 119, 87, text);
const green = (text: string) => rgb(110, 200, 120, text);
const red = (text: string) => rgb(235, 100, 100, text);
const code = (text: string) => rgb(150, 160, 250, text);
const faint = (text: string) => rgb(120, 124, 132, text);
const soft = (text: string) => rgb(190, 194, 202, text);
const yellow = (text: string) => rgb(240, 190, 80, text);
const removedBand = (text: string) => `\x1b[48;2;74;24;28m${text}\x1b[49m`;
const addedBand = (text: string) => `\x1b[48;2;24;58;34m${text}\x1b[49m`;
const userBand = (text: string) => `\x1b[48;2;36;38;44m${text}\x1b[49m`;
const CURSOR = '\x1b[7m \x1b[27m';

type Word = { text: string; code: boolean };
const words = (text: string): Word[] => text.split(/(`[^`]+`)/).flatMap((part): Word[] => part.startsWith('`') ? [{ text: part.slice(1, -1), code: true }] : part.split(' ').filter(Boolean).map((word): Word => ({ text: word, code: false })));

function wrap(text: string, width: number, paint: (text: string) => string = soft): string[] {
  const lines: Word[][] = [[]];
  for (const word of words(text)) {
    const line = lines[lines.length - 1];
    const used = line.reduce((total, item) => total + item.text.length + 1, 0);
    if (line.length && used + word.text.length > width) lines.push([word]); else line.push(word);
  }
  return lines.map((line) => line.map((word) => word.code ? code(word.text) : paint(word.text)).join(' '));
}

const visibleLength = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '').length;
const hang = (lines: string[], first: string, rest = ' '.repeat(visibleLength(first))) => lines.map((line, index) => (index ? rest : first) + line);
const pad = (text: string, width: number) => text + ' '.repeat(Math.max(0, width - visibleLength(text)));
const clip = (text: string, width: number) => visibleLength(text) <= width ? text : text.slice(0, width - 1) + '…';

function blockLines(block: Block, width: number): string[] {
  const body = width - 2;
  if (block.kind === 'user') return ['', ...wrap(block.text, body - 2).map((line, index) => userBand(pad(`${index ? '  ' : faint('❯ ')}${line}`, width))), ''];
  if (block.kind === 'say') return ['', ...hang(wrap(block.text, body), orange('● '))];
  if (block.kind === 'tool') return ['', `${green('●')} ${soft(block.name)}${faint('(' + clip(block.args, width - block.name.length - 5) + ')')}`, ...(block.result ?? []).flatMap((line) => hang(wrap(line, body - 3, faint), faint('  ⎿  '), '     '))];
  if (block.kind === 'diff') return block.lines.map((line) => { const text = pad(clip(line, width - 4), width - 4); return '    ' + (line[0] === '+' ? addedBand(soft(text)) : line[0] === '-' ? removedBand(soft(text)) : faint(text)); });
  return ['', faint(`✻ ${block.text}`)];
}

const spinnerLine = (tick: number) => `${orange(SPINNER_GLYPHS[tick % SPINNER_GLYPHS.length])} ${orange('Forming…')} ${faint(`(${START_SECONDS + Math.floor(tick / TICKS_PER_SECOND)}s · ↓ ${START_TOKENS + tick * TOKENS_PER_TICK} tokens)`)}`;

function footer(thread: DemoThread, width: number, draft: string, tick: number): string[] {
  const rule = faint('─'.repeat(width));
  const status = `${faint('~/src/')}${soft(thread.project)} ${rgb(110, 180, 200, 'main')} ${yellow(thread.context + '%')} ${faint(thread.model)}`;
  const mode = `${yellow('▸▸ auto mode on')} ${faint('(shift+tab to cycle)')}`;
  if (thread.ask) return ['', ...wrap(thread.ask.question, width - 2, soft), '', ...thread.ask.options.flatMap((option, index) => wrap(option, width - 5).map((line, row) => (row ? '    ' : index ? `  ${index + 1}. ` : `${orange('❯ ')}1. `) + line)), '', status, mode];
  return [...(thread.status === 'working' ? ['', spinnerLine(tick)] : []), '', rule, `${faint('❯')} ${draft}${CURSOR}`, rule, status, mode];
}

const paint = (lines: string[], rows: number) => '\x1b[?25l\x1b[2J\x1b[H' + lines.slice(0, rows).map((line, row) => `\x1b[${row + 1};1H${line}\x1b[K`).join('');

export function renderScreen(thread: DemoThread, cols: number, rows: number, draft = '', tick = 0): string {
  const tail = footer(thread, cols, draft, tick);
  const room = Math.max(0, rows - tail.length);
  const body = thread.transcript.flatMap((block) => blockLines(block, cols));
  const visible = body.length > room ? body.slice(body.length - room) : body;
  return paint([...visible, ...tail], rows);
}

const shellPrompt = (thread: DemoThread, cols: number, left: string) => {
  const where = `~/src/${thread.project} main`;
  return pad(left, Math.max(0, cols - where.length)) + faint(where);
};
const shellLine = (line: string, cols: number) => {
  const text = clip(line.replace(/^[!?]\t/, '        ').replace(/\t/, '        '), cols);
  return /^[!?]\t/.test(line) ? red(text) : soft(text);
};

export function renderShell(thread: DemoThread, cols: number, rows: number): string {
  const { command, lines } = thread.shell!;
  return paint([shellPrompt(thread, cols, `${faint('❯')} ${soft(command)}`), ...lines.map((line) => shellLine(line, cols)), shellPrompt(thread, cols, `${faint('❯')} ${CURSOR}`)], rows);
}
