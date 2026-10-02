import { expect, it } from 'vitest';
import { decodeOsc52ClipboardWrite } from '../src/client/terminal-clipboard';

const base64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');
it('decodes OSC 52 clipboard writes as UTF-8 text', () => {
  expect(decodeOsc52ClipboardWrite('c;' + base64('héllo 🙂'))).toBe('héllo 🙂');
  expect(decodeOsc52ClipboardWrite(';' + base64('default target'))).toBe('default target');
});
it('ignores clipboard read requests and malformed payloads', () => {
  expect(decodeOsc52ClipboardWrite('c;?')).toBeUndefined();
  expect(decodeOsc52ClipboardWrite('c;')).toBeUndefined();
  expect(decodeOsc52ClipboardWrite(base64('no target separator'))).toBeUndefined();
  expect(decodeOsc52ClipboardWrite('c;not base64!')).toBeUndefined();
  expect(decodeOsc52ClipboardWrite('c;' + Buffer.from([0xff, 0xfe]).toString('base64'))).toBeUndefined();
});
