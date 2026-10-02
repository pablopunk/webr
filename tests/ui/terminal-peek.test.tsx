import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThreadView } from '../../src/components/ThreadView';
import type { Thread } from '../../src/lib/models';
import type { Layout } from '../../src/shared/runtime';

vi.mock('../../src/components/TerminalPane', () => ({ TerminalPane: ({ pane }: { pane: { title: string } }) => <section aria-label={`${pane.title} terminal`} /> }));
afterEach(cleanup);
const thread = (terminalHidden: boolean): Thread => ({ id: 't', avatarIndex: 0, projectId: 'p', machineId: 'local', title: 'Thread', prompt: '', agent: 'claude', model: 'Default', status: 'idle', updatedAt: new Date().toISOString(), branch: '', worktree: true, session: 's', tabId: 'w1:t1', bindingState: 'attached', terminalHidden,
  panes: [{ id: 'w1:p1', title: 'Claude', kind: 'agent', terminalId: 'a' }, { id: 'w1:p2', title: 'Shell', kind: 'shell', terminalId: 'b' }] });
const layout = (shell: Layout['area']): Layout => ({ workspaceId: 'w1', tabId: 'w1:t1', area: { x: 0, y: 0, width: 100, height: 40 }, panes: [{ paneId: 'w1:p1', rect: { x: 0, y: 0, width: 65, height: 40 } }, { paneId: 'w1:p2', rect: shell }] });
const show = (hidden: boolean, shell: Layout['area'], onToggleTerminal = vi.fn()) => { render(<ThreadView thread={thread(hidden)} layouts={[layout(shell)]} tabs={[]} connected canControl focusedPane="w1:p1" onFocusPane={() => {}} onToggleTerminal={onToggleTerminal} />); return onToggleTerminal; };

it('shows both panes while the terminal is open', () => {
  show(false, { x: 65, y: 0, width: 35, height: 40 });
  expect(screen.getByLabelText('Shell terminal')).toBeDefined(); expect(screen.queryByRole('button', { name: 'Show terminal' })).toBeNull();
});
it('keeps a hidden side terminal peeking on the right and opens it on click', () => {
  const toggle = show(true, { x: 65, y: 0, width: 35, height: 40 });
  expect(screen.queryByLabelText('Shell terminal')).toBeNull();
  const peek = screen.getByRole('button', { name: 'Show terminal' }); expect(peek.className).toContain('is-right');
  fireEvent.click(peek); expect(toggle).toHaveBeenCalledOnce();
});
it('keeps a hidden lower terminal peeking at the bottom', () => {
  show(true, { x: 0, y: 26, width: 100, height: 14 });
  expect(screen.getByRole('button', { name: 'Show terminal' }).className).toContain('is-bottom');
});
