import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdoptTab } from '../../src/components/AdoptTab';
import { exampleThreads } from '../../src/lib/models';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const thread = { ...exampleThreads()[0], id: '00000000-0000-4000-8000-000000000001', machineId: 'fixture', bindingState: 'detached' as const };
const tab = { tabId: 'w1:t1', workspaceId: 'w1', label: 'Restored tab', bound: false, panes: [{ id: 'w1:p1', terminalId: 'term_new', title: 'Shell' }] };
it('requires explicit confirmation, uses current tab terminal IDs and never resubmits the saved prompt', async () => {
  const fetch = vi.fn(async () => ({ ok: true })); const confirm = vi.fn(() => false); vi.stubGlobal('fetch', fetch); vi.stubGlobal('confirm', confirm);
  render(<AdoptTab thread={thread} tabs={[tab]} />); const user = userEvent.setup(); await user.selectOptions(screen.getByLabelText('Native tab to adopt'), tab.tabId);
  await user.click(screen.getByText('Adopt without restarting')); expect(fetch).not.toHaveBeenCalled(); confirm.mockReturnValue(true);
  await user.click(screen.getByText('Adopt without restarting')); expect(fetch).toHaveBeenCalledTimes(1);
  const request = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1]; expect(JSON.parse(request.body as string)).toEqual({ machineId: 'fixture', terminalIds: ['term_new'] }); expect(request.body).not.toContain(thread.prompt);
});
it('reports changed or conflicting identities instead of making an automatic second request', async () => {
  const fetch = vi.fn(async () => ({ ok: false })); vi.stubGlobal('fetch', fetch); vi.stubGlobal('confirm', () => true);
  render(<AdoptTab thread={thread} tabs={[tab]} />); const user = userEvent.setup(); await user.selectOptions(screen.getByLabelText('Native tab to adopt'), tab.tabId); await user.click(screen.getByText('Adopt without restarting'));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('tab changed')); expect(fetch).toHaveBeenCalledTimes(1);
});
