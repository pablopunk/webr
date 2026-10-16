import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThreadView } from '../../src/components/ThreadView';
import type { Thread } from '../../src/lib/models';
const committed = vi.hoisted(() => vi.fn());
vi.mock('../../src/components/TerminalPane', async () => {
  const { useLayoutEffect } = await import('react');
  return { TerminalPane: ({ pane, active }: { pane: { id: string; title: string }; active: boolean }) => {
    useLayoutEffect(() => { committed(pane.id, active); }, [pane.id, active]);
    return <section aria-label={`${pane.title} terminal`} />;
  } };
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const thread: Thread = { id: 't', avatarIndex: 0, metadataVersion: 0, titleSync: { version: 0, state: 'unknown' }, projectId: 'p', machineId: 'local', title: 'Thread', prompt: '', agent: 'claude', model: 'Default', status: 'idle', updatedAt: new Date().toISOString(), branch: '', worktree: true, session: 's', tabId: 'w1:t1', bindingState: 'attached',
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
it('shows only the focused pane on a narrow screen', () => {
  show(0, true);
  expect(screen.getByLabelText('One terminal')).toBeDefined(); expect(screen.queryByLabelText('Claude terminal')).toBeNull();
});

it.each([false, true])('commits navigation and the visible input owner together (narrow=%s)', (narrow) => {
  const props = { thread, connected: true, canControl: true, onFocusPane: vi.fn(), narrow };
  const view = render(<ThreadView {...props} focusedPane="a" windowStart={0} />);
  committed.mockClear();
  view.rerender(<ThreadView {...props} focusedPane="c" windowStart={1} />);
  // Deferring only the window/shown ID used to commit the old pane with
  // active=false before mounting the selected owner in a second commit.
  expect(committed).not.toHaveBeenCalledWith('a', false);
  expect(committed).toHaveBeenCalledWith('c', true);
  expect(screen.queryByLabelText('Claude terminal')).toBeNull();
  expect(screen.getByLabelText('Two terminal')).toBeDefined();
});

it('retains a detached thread without exposing stale terminals', () => {
  render(<ThreadView thread={{ ...thread, bindingState: 'detached' }} connected canControl focusedPane="b" onFocusPane={vi.fn()} windowStart={0} narrow={false} />);
  expect(screen.getByRole('main', { name: 'Thread tab' })).toBeDefined();
  expect(screen.queryByLabelText('One terminal')).toBeNull();
});

it('keeps a detached thread whose launch failed so the failure is shown', () => {
  render(<ThreadView thread={{ ...thread, panes: [], bindingState: 'detached', operation: { id: 'o', state: 'failed', step: 'prompt' } }} connected canControl focusedPane="" onFocusPane={vi.fn()} windowStart={0} narrow={false} />);
  expect(screen.getByRole('heading', { name: 'The launch stopped' })).toBeDefined();
});
it('keeps provider recovery status out of the thread view', () => {
  const detached = { ...thread, bindingState: 'detached' as const, providerSession: { source: 'herdr', agent: 'claude', kind: 'id' as const, value: 'session-1' }, recovery: { state: 'needs_attention' as const, reason: 'conversation_missing' } };
  render(<ThreadView thread={detached} connected canControl focusedPane="" onFocusPane={vi.fn()} windowStart={0} narrow={false} />);
  expect(screen.getByText('No live panes are available for this thread.')).toBeDefined();
  expect(screen.queryByText(/Session verified|Session unverified|Recovery needs attention|conversation_missing/i)).toBeNull();
});
