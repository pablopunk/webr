import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThreadView } from '../../src/components/ThreadView';
import type { Thread } from '../../src/lib/models';
import { navigate } from 'astro:transitions/client';

vi.mock('astro:transitions/client', () => ({ navigate: vi.fn() }));
vi.mock('../../src/components/TerminalPane', () => ({ TerminalPane: ({ pane }: { pane: { title: string } }) => <section aria-label={`${pane.title} terminal`} /> }));
afterEach(cleanup);
const thread: Thread = { id: 't', avatarIndex: 0, projectId: 'p', machineId: 'local', title: 'Thread', prompt: '', agent: 'claude', model: 'Default', status: 'idle', updatedAt: new Date().toISOString(), branch: '', worktree: true, session: 's', tabId: 'w1:t1', bindingState: 'attached',
  panes: [{ id: 'a', title: 'Claude', kind: 'agent', terminalId: 'ta' }, { id: 'b', title: 'One', kind: 'shell', terminalId: 'tb' }, { id: 'c', title: 'Two', kind: 'shell', terminalId: 'tc' }] };
const show = (windowStart: number, narrow = false, onFocusPane = vi.fn()) => { render(<ThreadView thread={thread} connected canControl focusedPane="b" onFocusPane={onFocusPane} windowStart={windowStart} narrow={narrow} />); return onFocusPane; };

it('shows two panes and collapses the others in order', () => {
  const focus = show(1);
  expect(screen.queryByLabelText('Claude terminal')).toBeNull();
  expect(screen.getByLabelText('One terminal')).toBeDefined(); expect(screen.getByLabelText('Two terminal')).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'Show Claude' })); expect(focus).toHaveBeenCalledWith('a');
});
it('collapses panes on the right side of the window', () => {
  show(0);
  expect(screen.getByLabelText('Claude terminal')).toBeDefined(); expect(screen.getByRole('button', { name: 'Show Two' })).toBeDefined();
});
it('shows panes as tabs on a narrow screen', () => {
  const focus = show(0, true);
  expect(screen.getByLabelText('One terminal')).toBeDefined(); expect(screen.queryByLabelText('Claude terminal')).toBeNull();
  expect(screen.getByRole('tab', { name: 'One' }).getAttribute('aria-selected')).toBe('true');
  fireEvent.click(screen.getByRole('tab', { name: 'Two' })); expect(focus).toHaveBeenCalledWith('c');
});

it('redirects a detached thread to the new thread page', () => {
  render(<ThreadView thread={{ ...thread, bindingState: 'detached' }} connected canControl focusedPane="b" onFocusPane={vi.fn()} windowStart={0} narrow={false} />);
  expect(navigate).toHaveBeenCalledWith('/new?project=p');
});
