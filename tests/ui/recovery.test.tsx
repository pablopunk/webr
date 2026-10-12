import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ThreadRecoveryNotice } from '../../src/components/ThreadRecovery';
import type { Thread } from '../../src/lib/models';

afterEach(cleanup);
const thread = (overrides: Partial<Thread> = {}): Thread => ({ id: 't1', avatarIndex: 0, projectId: 'p', machineId: 'local', title: 'Thread', prompt: '', agent: 'omp', model: 'Default', status: 'unknown', updatedAt: new Date().toISOString(), branch: '', worktree: false, session: 'default', tabId: 'w1:t1', panes: [], ...overrides });

it('never labels an active-looking pane verified without a provider session identity', () => {
  render(<ThreadRecoveryNotice thread={thread({ recovery: { state: 'active' } })} />);
  expect(screen.getByText('Session unverified')).toBeDefined();
  expect(screen.queryByText('Session verified')).toBeNull();
});

it('labels a reported provider identity verified only after checkout reconciliation', () => {
  render(<ThreadRecoveryNotice thread={thread({ providerSession: { source: 'herdr:omp', agent: 'omp', kind: 'path', value: '/session.jsonl' }, recovery: { state: 'active' } })} />);
  expect(screen.getByText('Session verified')).toBeDefined();
  expect(screen.getByText('Herdr reports the saved provider session in the expected checkout.')).toBeDefined();
});

it('replaces arbitrary restore errors with safe recovery guidance', () => {
  render(<ThreadRecoveryNotice thread={thread({ recovery: { state: 'needs_attention', reason: 'resume argv --token secret /private/path' } })} />);
  expect(screen.getByText('Recovery needs attention')).toBeDefined();
  expect(screen.getByText('The saved thread could not be safely matched to a live provider session. Check the session and checkout in Herdr.')).toBeDefined();
  expect(screen.queryByText(/secret|private\/path/)).toBeNull();
});
