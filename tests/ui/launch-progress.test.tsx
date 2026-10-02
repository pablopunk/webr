import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { LaunchProgress } from '../../src/components/LaunchProgress';
import { Sidebar } from '../../src/components/Sidebar';
import { isListedThread } from '../../src/lib/launch';
import type { Thread } from '../../src/lib/models';

vi.mock('astro:transitions/client', () => ({ navigate: vi.fn() }));

afterEach(cleanup);
const thread = (overrides: Partial<Thread> = {}): Thread => ({ id: 't1', avatarIndex: 0, projectId: 'local:p', machineId: 'local', title: 'Fix the bug', prompt: 'Fix the bug in the parser', agent: 'claude', model: 'Default', status: 'unknown', updatedAt: new Date().toISOString(), branch: '', worktree: true, session: 'default', tabId: '', panes: [], bindingState: 'pending', operation: { id: 'o1', state: 'running', step: 'checkout' }, ...overrides });
const agentPane = { id: 'w1:p1', terminalId: 'term_1', title: 'Claude', kind: 'agent' as const };

it('lists a launching thread before it has any pane, and a recent failure, but not an old one or a bare detached thread', () => {
  expect(isListedThread(thread())).toBe(true);
  expect(isListedThread(thread({ operation: { id: 'o1', state: 'unknown', step: 'start' } }))).toBe(true);
  expect(isListedThread(thread({ operation: { id: 'o1', state: 'unknown', step: 'start' }, updatedAt: new Date(Date.now() - 3_600_000).toISOString() }))).toBe(false);
  expect(isListedThread(thread({ operation: undefined, bindingState: 'detached' }))).toBe(false);
  expect(isListedThread(thread({ operation: undefined, bindingState: 'attached', panes: [agentPane] }))).toBe(true);
});
it('shows the prompt and marks finished, active and waiting steps', () => {
  render(<LaunchProgress thread={thread({ operation: { id: 'o1', state: 'running', step: 'start' } })} />);
  expect(screen.getByText('Fix the bug in the parser')).toBeDefined();
  expect(screen.getByText('Creating the worktree').closest('li')?.className).toContain('is-done');
  expect(screen.getByText('Starting the agent').closest('li')?.getAttribute('aria-current')).toBe('step');
  expect(screen.getByText('Sending your prompt').closest('li')?.className).toContain('is-waiting');
});
it('explains a stopped launch and offers a way forward instead of a bare state name', () => {
  render(<LaunchProgress thread={thread({ operation: { id: 'o1', state: 'unknown', step: 'start' } })} />);
  expect(screen.getByRole('alert').textContent).toContain('stopped while starting the agent');
  expect(screen.getByRole('link', { name: 'Start a new thread' }).getAttribute('href')).toBe('/new?project=local%3Ap');
});
it('shows a launching thread in the sidebar with its current step', () => {
  render(<Sidebar projects={[]} threads={[thread()]} machines={[]} mode="threads" onModeChange={() => {}} collapsed={false} mobileOpen={false} onCollapse={() => {}} onCloseMobile={() => {}} />);
  expect(screen.getByText('Creating the worktree…')).toBeDefined(); expect(screen.getByText('Fix the bug')).toBeDefined();
});
