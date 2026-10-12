import { expect, it } from 'vitest';
import { isListedThread } from '../../src/lib/launch';
import type { Thread } from '../../src/lib/models';

const thread = (overrides: Partial<Thread> = {}): Thread => ({ id: 't1', avatarIndex: 0, projectId: 'local:p', machineId: 'local', title: 'Fix the bug', prompt: 'Fix the bug in the parser', agent: 'claude', model: 'Default', status: 'unknown', updatedAt: new Date().toISOString(), branch: '', worktree: true, session: 'default', tabId: '', panes: [], bindingState: 'pending', operation: { id: 'o1', state: 'running', step: 'checkout' }, ...overrides });
const agentPane = { id: 'w1:p1', terminalId: 'term_1', title: 'Claude', kind: 'agent' as const };

it('keeps persisted agent intent visible after failures and disconnection while hiding shell-only tabs', () => {
  expect(isListedThread(thread())).toBe(true);
  expect(isListedThread(thread({ operation: { id: 'o1', state: 'unknown', step: 'start' } }))).toBe(true);
  expect(isListedThread(thread({ operation: { id: 'o1', state: 'unknown', step: 'start' }, updatedAt: new Date(Date.now() - 3_600_000).toISOString() }))).toBe(true);
  expect(isListedThread(thread({ operation: undefined, bindingState: 'detached' }))).toBe(true);
  expect(isListedThread(thread({ agent: '', operation: undefined, bindingState: 'attached' }))).toBe(false);
  expect(isListedThread(thread({ operation: undefined, bindingState: 'attached', panes: [agentPane] }))).toBe(true);
});
