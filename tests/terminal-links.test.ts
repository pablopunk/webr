// @vitest-environment jsdom
import { expect, test, vi } from 'vitest';
import { Terminal } from '@xterm/xterm';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { openLinkOnModifierClick } from '../src/client/terminal-links';

const linksOnFirstLine = async (text: string) => {
  const terminal = new Terminal({ cols: 80, rows: 5, allowProposedApi: true });
  let provider: { provideLinks: (line: number, done: (links: { text: string }[]) => void) => void } | undefined;
  const register = terminal.registerLinkProvider.bind(terminal);
  terminal.registerLinkProvider = (candidate) => { provider = candidate as typeof provider; return register(candidate); };
  terminal.loadAddon(new WebLinksAddon(openLinkOnModifierClick));
  await new Promise<void>((done) => terminal.write(text, done));
  return new Promise<string[]>((done) => provider!.provideLinks(1, (links) => done(links.map((link) => link.text))));
};

test('detects urls in terminal output', async () => {
  expect(await linksOnFirstLine('see https://google.es ok')).toEqual(['https://google.es']);
});

test('opens a link only on Cmd or Ctrl click', () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  openLinkOnModifierClick(new MouseEvent('click'), 'https://google.es');
  expect(open).not.toHaveBeenCalled();
  openLinkOnModifierClick(new MouseEvent('click', { metaKey: true }), 'https://google.es');
  openLinkOnModifierClick(new MouseEvent('click', { ctrlKey: true }), 'https://google.es');
  expect(open).toHaveBeenCalledTimes(2);
});
