// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { initialWorktreeChoice, readNewSessionBehavior, recordWorktreeChoice, writeNewSessionBehavior } from '../../src/client/new-session-behavior';

beforeEach(() => localStorage.clear());

it('defaults to remembering by project and honors the old setting', () => {
  expect(readNewSessionBehavior()).toBe('remember');
  expect(initialWorktreeChoice('local', 'p')).toBe(true);
  localStorage.setItem('webr-new-worktree', 'false');
  expect(readNewSessionBehavior()).toBe('main');
});

it('always uses the main checkout or a new worktree when chosen', () => {
  writeNewSessionBehavior('main'); recordWorktreeChoice('local', 'p', true);
  expect(initialWorktreeChoice('local', 'p')).toBe(false);
  writeNewSessionBehavior('worktree'); recordWorktreeChoice('local', 'p', false);
  expect(initialWorktreeChoice('local', 'p')).toBe(true);
});

it('remembers the last choice for each project separately', () => {
  writeNewSessionBehavior('remember');
  recordWorktreeChoice('local', 'a', false); recordWorktreeChoice('local', 'b', true);
  expect(initialWorktreeChoice('local', 'a')).toBe(false);
  expect(initialWorktreeChoice('local', 'b')).toBe(true);
  expect(initialWorktreeChoice('local', 'new')).toBe(true);
});
