import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import type { AppNavigate } from '../../src/client/app-navigation';
import { buildRouteUrl } from '../../src/client/navigation';
import { CreateWorkspace } from '../../src/components/CreateWorkspace';
import { NewThreadView } from '../../src/components/NewThreadView';
import { defaultThreadTickets } from '../../src/client/create-tickets';

vi.mock('astro:transitions/client', () => ({ navigate: vi.fn() }));
vi.mock('../../src/client/catalog', () => ({ useMachineCatalog: () => ({ data: { harnesses: [] }, isError: false }) }));

const workspaceRequests = (fetch: { mock: { calls: unknown[] } }) => (fetch.mock.calls as unknown as [string, RequestInit][]).filter(([url]) => url === '/api/workspaces');
const operationId = '55555555-5555-4555-8555-555555555555';
const envelope = (state: 'ready' | 'unknown') => ({ operationId, kind: 'workspace', state, step: state, ...(state === 'ready' ? { result: { workspaceId: 'w1', tabId: 'w1:t1', paneId: 'w1:p1', terminalId: 'term_workspace' } } : {}), statusUrl: `/api/operations/${operationId}` });
const renderWithQuery = (children: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>);
function StaleWorkspacePending() {
  const [pendingKey, setPendingKey] = useState<string | undefined>('expired-workspace-ticket');
  const onNavigate: AppNavigate = (target) => {
    const href = typeof target === 'string' ? target : buildRouteUrl(target);
    setPendingKey(new URL(href, 'http://localhost').searchParams.get('workspacePending') ?? undefined);
  };
  return <NewThreadView projects={[]} machines={[{ id: 'local', name: 'Local', connected: true, writable: true, session: 'default', projectPaths: {}, harnesses: [] }]} workspacePendingKey={pendingKey} onOpenSidebar={() => {}} onNavigate={onNavigate} />;
}
afterEach(() => { cleanup(); defaultThreadTickets().clearOnAccessLoss(); vi.unstubAllGlobals(); sessionStorage.clear(); });
it('shows a connected empty Herdr session as a workspace creation form, not a setup failure', () => {
  renderWithQuery(<NewThreadView projects={[]} machines={[{ id: 'local', name: 'Local', connected: true, writable: true, session: 'default', projectPaths: {}, harnesses: [] }]} onOpenSidebar={() => {}} />);
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('What do you want to build today?');
  expect(screen.getByRole('form', { name: 'Create workspace' })).toBeDefined();
  expect(screen.getByText('This Herdr session has no projects yet.')).toBeDefined();
  expect(screen.queryByText('No target is configured.')).toBeNull();
});
it('lets an empty-session composer leave an unavailable pending create after scope change', async () => {
  renderWithQuery(<StaleWorkspacePending />);
  expect((screen.getByLabelText('Project folder') as HTMLInputElement).disabled).toBe(true);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect((screen.getByLabelText('Project folder') as HTMLInputElement).disabled).toBe(false);
  expect(screen.queryByText(/pending workspace ticket is unavailable/i)).toBeNull();
});
it('selects the confirmed new project after an inline workspace create', async () => {
  const fetch = vi.fn(async (url: string, _request: RequestInit) => ({ ok: true, status: 202, json: async () => url === '/api/workspaces' ? envelope('ready') : [] })); vi.stubGlobal('fetch', fetch);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const before = { id: 'local', name: 'Local', connected: true, writable: true, session: 'default', projectPaths: {}, harnesses: [] };
  const created = { id: 'local:project', name: 'Project', path: '/project', color: '#555', initial: 'P', metadataVersion: 0 };
  const view = render(<QueryClientProvider client={queryClient}><NewThreadView projects={[]} machines={[before]} onOpenSidebar={() => {}} /></QueryClientProvider>);
  const user = userEvent.setup(); await user.type(screen.getByLabelText('Project folder'), '/project'); await user.type(screen.getByLabelText('Workspace name'), 'Project');
  await user.click(screen.getByRole('button', { name: 'Create workspace' }));
  await waitFor(() => expect(fetch.mock.calls.some(([url]) => url === '/api/workspaces')).toBe(true));
  const request = fetch.mock.calls.find(([url]) => url === '/api/workspaces')?.[1];
  const key = (request?.headers as Record<string, string>)['Idempotency-Key'];
  await waitFor(() => expect(defaultThreadTickets().getResource(key!)?.state).toBe('ready'));
  view.rerender(<QueryClientProvider client={queryClient}><NewThreadView projects={[created]} machines={[{ ...before, projectPaths: { [created.id]: created.path } }]} onOpenSidebar={() => {}} /></QueryClientProvider>);
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Project: Project' })).toBeDefined());
});
it('creates the first workspace from normalized input and completes the inline callback', async () => {
  const fetch = vi.fn(async (url: string) => ({ ok: true, status: 202, json: async () => url === '/api/workspaces' ? envelope('ready') : [] })); vi.stubGlobal('fetch', fetch);
  const created = vi.fn(); renderWithQuery(<CreateWorkspace machineId="local" onCreated={created} />);
  const user = userEvent.setup(); await user.type(screen.getByLabelText('Project folder'), '/project'); await user.type(screen.getByLabelText('Workspace name'), ' Project ');
  await user.click(screen.getByRole('button', { name: 'Create workspace' }));
  await waitFor(() => expect(created).toHaveBeenCalledTimes(1));
  const [url, request] = workspaceRequests(fetch)[0];
  expect(url).toBe('/api/workspaces'); expect(JSON.parse(request.body as string)).toEqual({ machineId: 'local', path: '/project', label: 'Project' });
  expect(request.headers).toMatchObject({ 'Idempotency-Key': expect.any(String) });
});
it('keeps an uncertain native create visible and never resubmits it', async () => {
  const fetch = vi.fn(async (url: string) => ({ ok: true, status: 202, json: async () => url === '/api/workspaces' ? envelope('unknown') : [] })); vi.stubGlobal('fetch', fetch);
  const created = vi.fn(); renderWithQuery(<CreateWorkspace machineId="local" onCreated={created} />);
  const user = userEvent.setup(); await user.type(screen.getByLabelText('Project folder'), '/project'); await user.type(screen.getByLabelText('Workspace name'), 'Project');
  await user.click(screen.getByRole('button', { name: 'Create workspace' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('will not replay'));
  expect(workspaceRequests(fetch)).toHaveLength(1); expect(created).not.toHaveBeenCalled();
  expect((screen.getByRole('button', { name: 'Create workspace' }) as HTMLButtonElement).disabled).toBe(true);
});
it('completes a typed folder prefix from server suggestions with Tab', async () => {
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ['~/src/', '~/srv/'] })); vi.stubGlobal('fetch', fetch);
  renderWithQuery(<CreateWorkspace machineId="local" onCreated={() => {}} />);
  const user = userEvent.setup(); const input = screen.getByLabelText('Project folder') as HTMLInputElement;
  await user.type(input, '~/sr'); await screen.findByRole('option', { name: '~/src/' });
  await user.keyboard('{ArrowDown}{Tab}');
  expect(input.value).toBe('~/srv/');
});
it('accepts the highlighted folder on Enter and closes the dropdown without submitting', async () => {
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ['~/src/', '~/srv/'] })); vi.stubGlobal('fetch', fetch);
  renderWithQuery(<CreateWorkspace machineId="local" onCreated={() => {}} />);
  const user = userEvent.setup(); const input = screen.getByLabelText('Project folder') as HTMLInputElement;
  await user.type(input, '~/sr'); await screen.findByRole('option', { name: '~/src/' });
  await user.keyboard('{Enter}');
  expect(input.value).toBe('~/src/'); expect(screen.queryByRole('listbox')).toBeNull(); expect(workspaceRequests(fetch)).toHaveLength(0);
});
