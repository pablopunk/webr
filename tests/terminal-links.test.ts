// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { Terminal } from '@xterm/xterm';
import { urlAtCell } from '../src/client/terminal-links';

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
