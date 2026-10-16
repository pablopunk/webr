import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { usePendingPaneActions } from '../../src/client/pending-pane-actions';
import { PaneActionError, closeThreadPane, openThreadTerminal } from '../../src/client/thread-actions';
import { ThreadView } from '../../src/components/ThreadView';
import { exampleThreads, type Thread } from '../../src/lib/models';
import type { Projection } from '../../src/shared/runtime';

vi.mock('../../src/client/thread-actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/thread-actions')>();
  return { ...actual, openThreadTerminal: vi.fn(), closeThreadPane: vi.fn() };
});
vi.mock('../../src/components/TerminalPane', async () => {
  const { createElement } = await import('react');
  return { TerminalPane: ({ pane }: { pane: { terminalId?: string } }) => createElement('section', { 'data-testid': `terminal-${pane.terminalId}` }) };
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const focus = vi.fn();
const originalThread: Thread = {
  ...exampleThreads()[0]!, id: 'thread-test', machineId: 'machine-test', session: 'session-test', tabId: 'tab-test', bindingState: 'attached',
  bindingFingerprint: 'fingerprint-test', bindingConfigVersion: 4,
  panes: [
    { id: 'pane-agent', title: 'Agent', kind: 'agent', terminalId: 'terminal-agent' },
    { id: 'pane-shell', title: 'Shell', kind: 'shell', terminalId: 'terminal-shell' },
  ],
};
const projection = (thread: Thread = originalThread, revision = 1, connected = true, freshAt: string | null = 'fresh') => ({
  machineId: thread.machineId, generation: 'generation-test', revision, connected, freshAt, threads: [thread], projects: [], layouts: [], availableTabs: [],
}) as Projection;
const cancelClose = async () => false;
function Harness({ observation = projection(), thread: threadOverride, routeKey = 'thread-route', confirmClose = cancelClose }: {
  observation?: Projection; thread?: Thread; routeKey?: string; confirmClose?: (message: string) => Promise<boolean>;
}) {
  const thread = threadOverride ?? observation.threads[0]!;
  const [focusedPane, setFocusedPane] = useState('pane-shell');
  const focusPane = (scope: string, paneId: string) => { focus(scope, paneId); setFocusedPane(paneId); };
  const actions = usePendingPaneActions({ thread, projection: observation, routeKey, scope: 'machine-test:thread-test', focusedPane, windowStart: 0, focusPane, confirmClose });
  return <>
    <button type="button" onClick={() => actions.openTerminal()}>Split pane</button>
    <button type="button" onClick={() => actions.openTerminal('pane-shell-reidentified')}>Split reidentified pane</button>
    <button type="button" onClick={() => actions.openTerminal('pane-other')}>Split unrelated terminal</button>
    <button type="button" onClick={() => actions.closePane()}>Close pane</button>
    <button type="button" onClick={() => actions.closePane('pane-reidentified')}>Close reidentified pane</button>
    <output aria-label="Focused pane">{focusedPane}</output>
    <ThreadView thread={thread} connected={observation.connected} canControl focusedPane={focusedPane} onFocusPane={setFocusedPane} windowStart={0} narrow={false}
      pendingSplits={actions.pendingSplits} pendingCloses={actions.pendingCloses} paneActionNotice={actions.notice}
      onDismissPendingSplit={actions.dismissSplit} onDismissPendingClose={actions.dismissClose} onDismissPaneActionNotice={actions.dismissNotice} />
  </>;
}

it('shows a local split slot immediately, guards duplicate clicks, and never mounts a synthetic terminal', () => {
  let release!: (value: { paneId: string }) => void;
  vi.mocked(openThreadTerminal).mockReturnValueOnce(new Promise<{ paneId: string }>((resolve) => { release = (value) => resolve(value); }));
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Split pane' }));
  expect(screen.getByText('Creating terminal pane…')).toBeTruthy();
  expect(screen.getByTestId('terminal-terminal-agent')).toBeTruthy();
  expect(screen.getByTestId('terminal-terminal-shell')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Split pane' }));
  expect(openThreadTerminal).toHaveBeenCalledTimes(1);
  expect(openThreadTerminal).toHaveBeenCalledWith(originalThread, 'pane-shell');
  expect(screen.queryByTestId('terminal-undefined')).toBeNull();
  void release;
});

it('waits for the exact returned native pane instead of correlating an unrelated new pane', async () => {
  let release!: (value: { paneId: string }) => void;
  vi.mocked(openThreadTerminal).mockReturnValueOnce(new Promise<{ paneId: string }>((resolve) => { release = (value) => resolve(value); }));
  const view = render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Split pane' }));
  const unrelated = { id: 'pane-from-another-client', title: 'Other', kind: 'shell' as const, terminalId: 'terminal-other' };
  view.rerender(<Harness observation={projection({ ...originalThread, panes: [...originalThread.panes, unrelated] }, 2)} />);
  await act(async () => { release({ paneId: 'pane-from-this-split' }); });
  expect(screen.getByText(/Waiting for the new pane to appear/)).toBeTruthy();
  expect(focus).not.toHaveBeenCalled();
  const confirmed = { id: 'pane-from-this-split', title: 'Shell', kind: 'shell' as const, terminalId: 'terminal-confirmed' };
  view.rerender(<Harness observation={projection({ ...originalThread, panes: [...originalThread.panes, unrelated, confirmed] }, 3)} />);
  await waitFor(() => expect(screen.queryByText(/Waiting for the new pane to appear/)).toBeNull());
  expect(screen.getByTestId('terminal-terminal-confirmed')).toBeTruthy();
  expect(focus).toHaveBeenCalledWith('machine-test:thread-test', 'pane-from-this-split');
});

it('clears pending UI and reports a definitive pre-effect refusal', async () => {
  vi.mocked(openThreadTerminal).mockRejectedValueOnce(new PaneActionError(404, 'thread_not_found', false, 'This thread does not exist anymore.'));
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Split pane' }));
  expect((await screen.findByRole('alert')).textContent).toContain('This thread does not exist anymore.');
  expect(screen.queryByText('Creating terminal pane…')).toBeNull();
});

it('keeps an uncertain split visible and prevents replay even after its marker is dismissed', async () => {
  vi.mocked(openThreadTerminal).mockRejectedValueOnce(new PaneActionError(0, undefined, true, 'lost response'));
  const view = render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Split pane' }));
  await screen.findByText(/Split outcome is uncertain/);
  fireEvent.click(screen.getByRole('button', { name: 'Split pane' }));
  expect(openThreadTerminal).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss split status' }));
  expect(screen.queryByText(/Split outcome is uncertain/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Split pane' }));
  expect(openThreadTerminal).toHaveBeenCalledTimes(1);
  const reidentified = projection({ ...originalThread, panes: [originalThread.panes[0]!, { ...originalThread.panes[1]!, id: 'pane-shell-reidentified' }] }, 2);
  view.rerender(<Harness observation={reidentified} />);
  fireEvent.click(screen.getByRole('button', { name: 'Split reidentified pane' }));
  expect(openThreadTerminal).toHaveBeenCalledTimes(1);
});

it('keeps unresolved native-terminal guards across binding changes but allows other terminals', async () => {
  vi.mocked(openThreadTerminal)
    .mockRejectedValueOnce(new PaneActionError(0, undefined, true, 'lost split response'))
    .mockRejectedValueOnce(new PaneActionError(0, undefined, true, 'lost unrelated response'));
  vi.mocked(closeThreadPane).mockRejectedValueOnce(new PaneActionError(0, undefined, true, 'lost close response'));
  const view = render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Split pane' }));
  await screen.findByText(/Split outcome is uncertain/);
  fireEvent.click(screen.getByRole('button', { name: 'Close pane' }));
  await screen.findByText(/Close outcome is uncertain/);
  const rebound = { ...originalThread, bindingFingerprint: 'fingerprint-next', bindingConfigVersion: 5,
    panes: [originalThread.panes[0]!, { ...originalThread.panes[1]!, id: 'pane-shell-reidentified' }, { id: 'pane-other', title: 'Other', kind: 'shell' as const, terminalId: 'terminal-other' }] };
  view.rerender(<Harness observation={projection(rebound, 2)} />);
  fireEvent.click(screen.getByRole('button', { name: 'Split reidentified pane' }));
  expect(openThreadTerminal).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('alert').textContent).toContain('previous split');
  fireEvent.click(screen.getByRole('button', { name: 'Close reidentified pane' }));
  expect(closeThreadPane).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('alert').textContent).toContain('previous close');
  fireEvent.click(screen.getByRole('button', { name: 'Split unrelated terminal' }));
  expect(openThreadTerminal).toHaveBeenCalledTimes(2);
});

it('keeps close content mounted until an authoritative close acknowledgement, then focuses a real neighbor', async () => {
  let release!: (value: { closed: boolean; busy: boolean }) => void;
  vi.mocked(closeThreadPane).mockReturnValueOnce(new Promise<{ closed: boolean; busy: boolean }>((resolve) => { release = (value) => resolve(value); }));
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Close pane' }));
  expect(screen.getByText('Closing Shell…')).toBeTruthy();
  expect(screen.getByTestId('terminal-terminal-shell')).toBeTruthy();
  expect(focus).not.toHaveBeenCalled();
  await act(async () => { release({ closed: true, busy: false }); });
  expect(screen.queryByTestId('terminal-terminal-shell')).toBeNull();
  expect(screen.getByTestId('terminal-terminal-agent')).toBeTruthy();
  expect(focus).toHaveBeenCalledWith('machine-test:thread-test', 'pane-agent');
});

it('honors busy cancellation and makes a forced close only after explicit confirmation', async () => {
  const confirmClose = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  vi.mocked(closeThreadPane)
    .mockResolvedValueOnce({ closed: false, busy: true })
    .mockResolvedValueOnce({ closed: false, busy: true })
    .mockResolvedValueOnce({ closed: true, busy: false });
  render(<Harness confirmClose={confirmClose} />);
  fireEvent.click(screen.getByRole('button', { name: 'Close pane' }));
  await waitFor(() => expect(confirmClose).toHaveBeenCalledTimes(1));
  expect(closeThreadPane).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('terminal-terminal-shell')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Close pane' }));
  await waitFor(() => expect(closeThreadPane).toHaveBeenCalledTimes(3));
  expect(closeThreadPane).toHaveBeenNthCalledWith(1, originalThread, 'pane-shell', false);
  expect(closeThreadPane).toHaveBeenNthCalledWith(2, originalThread, 'pane-shell', false);
  expect(closeThreadPane).toHaveBeenNthCalledWith(3, originalThread, 'pane-shell', true);
  await waitFor(() => expect(screen.queryByTestId('terminal-terminal-shell')).toBeNull());
});

it('does not treat disconnected stale absence as close confirmation, then reconciles fresh scoped absence', async () => {
  vi.mocked(closeThreadPane).mockRejectedValueOnce(new PaneActionError(503, 'pane_outcome_unknown', true, 'uncertain'));
  const view = render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Close pane' }));
  await screen.findByText(/Close outcome is uncertain/);
  const reidentified = projection({ ...originalThread, panes: [originalThread.panes[0]!, { ...originalThread.panes[1]!, id: 'pane-reidentified' }] }, 2, true, 'fresh-reidentified');
  view.rerender(<Harness observation={reidentified} />);
  expect(screen.getByText(/Close outcome is uncertain/)).toBeTruthy();
  expect(screen.getByTestId('terminal-terminal-shell')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Close reidentified pane' }));
  expect(closeThreadPane).toHaveBeenCalledTimes(1);
  expect(focus).not.toHaveBeenCalled();
  const stale = projection({ ...originalThread, panes: [originalThread.panes[0]!] }, 3, false, null);
  view.rerender(<Harness observation={stale} thread={originalThread} />);
  expect(screen.getByText(/Close outcome is uncertain/)).toBeTruthy();
  expect(screen.getByTestId('terminal-terminal-shell')).toBeTruthy();
  expect(focus).not.toHaveBeenCalled();
  const fresh = projection({ ...originalThread, panes: [originalThread.panes[0]!] }, 4, true, 'fresh-again');
  view.rerender(<Harness observation={fresh} />);
  await waitFor(() => expect(screen.queryByText(/Close outcome is uncertain/)).toBeNull());
  expect(screen.queryByTestId('terminal-terminal-shell')).toBeNull();
  expect(focus).toHaveBeenCalledWith('machine-test:thread-test', 'pane-agent');
});

it('does not steal focus when a split resolves after navigation away', async () => {
  let release!: (value: { paneId: string }) => void;
  vi.mocked(openThreadTerminal).mockReturnValueOnce(new Promise<{ paneId: string }>((resolve) => { release = (value) => resolve(value); }));
  const view = render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Split pane' }));
  const added = { id: 'pane-native', title: 'Shell', kind: 'shell' as const, terminalId: 'terminal-native' };
  view.rerender(<Harness observation={projection({ ...originalThread, panes: [...originalThread.panes, added] }, 2)} routeKey="other-route" />);
  await act(async () => { release({ paneId: 'pane-native' }); });
  expect(focus).not.toHaveBeenCalled();
});
