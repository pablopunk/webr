import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { LaunchProgress } from '../../src/components/LaunchProgress';
import { isListedThread, launchFailureMessage, launchStepLabel } from '../../src/lib/launch';
import type { Thread } from '../../src/lib/models';

vi.mock('bot-avatars', async (importOriginal) => ({ ...await importOriginal<typeof import('bot-avatars')>(), BotAvatar: () => null }));

const thread = (overrides: Partial<Thread> = {}): Thread => ({ id: 't1', avatarIndex: 0, metadataVersion: 0, titleSync: { version: 0, state: 'unknown' }, projectId: 'local:p', machineId: 'local', title: 'Fix the bug', prompt: 'Fix the bug in the parser', agent: 'claude', model: 'Default', status: 'unknown', updatedAt: new Date().toISOString(), branch: '', worktree: true, session: 'default', tabId: '', panes: [], bindingState: 'pending', operation: { id: 'o1', state: 'running', step: 'checkout' }, ...overrides });
const agentPane = { id: 'w1:p1', terminalId: 'term_1', title: 'Claude', kind: 'agent' as const };

afterEach(() => cleanup());

it('keeps persisted agent intent visible after failures and disconnection while hiding shell-only tabs', () => {
  expect(isListedThread(thread())).toBe(true);
  expect(isListedThread(thread({ operation: { id: 'o1', state: 'unknown', step: 'start' } }))).toBe(true);
  expect(isListedThread(thread({ operation: { id: 'o1', state: 'unknown', step: 'start' }, updatedAt: new Date(Date.now() - 3_600_000).toISOString() }))).toBe(true);
  expect(isListedThread(thread({ operation: undefined, bindingState: 'detached' }))).toBe(true);
  expect(isListedThread(thread({ agent: '', operation: undefined, bindingState: 'attached' }))).toBe(false);
  expect(isListedThread(thread({ operation: undefined, bindingState: 'attached', panes: [agentPane] }))).toBe(true);
});

it('describes the actual launch resource and whether prompt delivery is uncertain', () => {
  expect(launchStepLabel('checkout', false)).toBe('Creating the tab');
  expect(launchStepLabel('checkout', true)).toBe('Creating the worktree');
  expect(launchStepLabel('checkout_complete', false)).toBe('Starting the agent');
  expect(launchFailureMessage('checkout', false)).toContain('The tab may already exist');
  expect(launchFailureMessage('checkout', false)).toContain('your prompt was not sent');
  expect(launchFailureMessage('prompt', true)).toContain('Prompt delivery is uncertain');
});

it('uses the animated orb while an agent launch is in progress', () => {
  render(<LaunchProgress thread={thread()} />);
  expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true');
  expect(document.querySelector('.loading-orb-visual')).not.toBeNull();
  expect(document.querySelector('.loading-step')?.textContent).toBe('Creating the worktree…');
  expect(screen.queryByRole('heading')).toBeNull();
});

it('animates the current step text when the launch advances', () => {
  const { rerender } = render(<LaunchProgress thread={thread({ operation: { id: 'o1', state: 'running', step: 'validate' } })} />);
  expect(document.querySelector('.loading-step')?.textContent).toBe('Checking the machine…');
  rerender(<LaunchProgress thread={thread({ operation: { id: 'o1', state: 'running', step: 'start' } })} />);
  expect(document.querySelector('.loading-step')?.textContent).toBe('Starting the agent…');
});

it('links a definitively failed launch back to its original draft', () => {
  render(<LaunchProgress thread={thread({ operation: { id: 'o1', state: 'failed', step: 'checkout' } })} />);
  expect(screen.getByRole('link', { name: 'Return to your draft' }).getAttribute('href'))
    .toBe('/new?project=local%3Ap&recover=t1');
});

it('does not offer a replay shortcut when the launch outcome is unknown', () => {
  render(<LaunchProgress thread={thread({ operation: { id: 'o1', state: 'unknown', step: 'prompt' } })} />);
  expect(screen.getByRole('heading', { name: 'Launch outcome uncertain' })).toBeDefined();
  expect(screen.queryByRole('link', { name: 'Return to your draft' })).toBeNull();
  expect(screen.getByRole('alert').textContent).toContain('outcome is uncertain');
});
