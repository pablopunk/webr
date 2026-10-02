import { expect, it } from 'vitest';
import { serverPort } from '../server/port';

it('reads the port from --port first, then PORT, then the default', () => {
  expect(serverPort(['--port', '4400'], { PORT: '5000' })).toBe(4400);
  expect(serverPort(['--port=4401'], {})).toBe(4401);
  expect(serverPort([], { PORT: '5000' })).toBe(5000);
  expect(serverPort([], {})).toBe(4321);
  expect(() => serverPort(['--port', 'abc'], {})).toThrow('The port must be a number');
});
