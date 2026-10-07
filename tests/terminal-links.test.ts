// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { Terminal } from '@xterm/xterm';
import { urlAtCell, urlFromSelectedCells } from '../src/client/terminal-links';

const selecting = (terminal: Terminal, start: { x: number; y: number }, end: { x: number; y: number } | undefined) => {
  terminal.getSelectionPosition = () => end && { start, end };
  return terminal;
};

const terminalShowing = async (text: string, cols = 80) => {
  const terminal = new Terminal({ cols, rows: 5, allowProposedApi: true });
  await new Promise<void>((done) => terminal.write(text, done));
  return terminal;
};

test('finds the url under a cell', async () => {
  const terminal = await terminalShowing('see https://google.es ok');
  expect(urlAtCell(terminal, 10, 0)).toBe('https://google.es');
  expect(urlAtCell(terminal, 1, 0)).toBeUndefined();
});

test('leaves trailing punctuation out of the url', async () => {
  const terminal = await terminalShowing('go to https://google.es/a.');
  expect(urlAtCell(terminal, 10, 0)).toBe('https://google.es/a');
  expect(urlAtCell(terminal, 25, 0)).toBeUndefined();
});

test('finds a url wrapped over two rows from either row', async () => {
  const terminal = await terminalShowing('https://example.com/a/long/path', 20);
  expect(urlAtCell(terminal, 3, 0)).toBe('https://example.com/a/long/path');
  expect(urlAtCell(terminal, 3, 1)).toBe('https://example.com/a/long/path');
});

test('rebuilds a modal url from a selection that also covers the text beside the modal', async () => {
  const terminal = await terminalShowing('background text https://a.com/x?\r\nmore background  y=1&z=2  tail\r\nxx background   &q=3');
  expect(urlFromSelectedCells(selecting(terminal, { x: 16, y: 0 }, { x: 20, y: 2 }))).toBe('https://a.com/x?y=1&z=2&q=3');
});

test('rebuilds a url wrapped by the terminal itself', async () => {
  const terminal = await terminalShowing('go https://example.com/a/long/path', 20);
  expect(urlFromSelectedCells(selecting(terminal, { x: 3, y: 0 }, { x: 14, y: 1 }))).toBe('https://example.com/a/long/path');
});

test('ignores selections that are not a url', async () => {
  const terminal = await terminalShowing('npm run dev');
  expect(urlFromSelectedCells(selecting(terminal, { x: 0, y: 0 }, { x: 11, y: 0 }))).toBeUndefined();
  expect(urlFromSelectedCells(selecting(terminal, { x: 0, y: 0 }, undefined))).toBeUndefined();
});
