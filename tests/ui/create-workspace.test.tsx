import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreateWorkspace } from '../../src/components/CreateWorkspace';
import { NewThreadView } from '../../src/components/NewThreadView';

vi.mock('astro:transitions/client', () => ({ navigate: vi.fn() }));
vi.mock('../../src/client/catalog', () => ({ useMachineCatalog: () => ({ data: { harnesses: [] }, isError: false }) }));

const workspaceRequests = (fetch: { mock: { calls: unknown[] } }) => (fetch.mock.calls as unknown as [string, RequestInit][]).filter(([url]) => url === '/api/workspaces');
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('shows a connected empty Herdr session as a workspace creation form, not a setup failure', () => {
  render(<NewThreadView projects={[]} machines={[{ id: 'local', name: 'Local', connected: true, writable: true, session: 'default', projectPaths: {}, harnesses: [] }]} onOpenSidebar={() => {}} />);
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('What do you want to build today?');
  expect(screen.getByRole('form', { name: 'Create workspace' })).toBeDefined();
  expect(screen.getByText('This Herdr session has no projects yet.')).toBeDefined();
  expect(screen.queryByText('No target is configured.')).toBeNull();
});
it('creates the first workspace with a path and name, without a source workspace or authentication', async () => {
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ workspaceId: 'w1' }) })); vi.stubGlobal('fetch', fetch);
  const created = vi.fn(); render(<CreateWorkspace machineId="local" onCreated={created} />);
  const user = userEvent.setup(); await user.type(screen.getByLabelText('Project folder'), '/project'); await user.type(screen.getByLabelText('Workspace name'), 'Project');
  await user.click(screen.getByRole('button', { name: 'Create workspace' }));
  await waitFor(() => expect(created).toHaveBeenCalledTimes(1));
  const [url, request] = workspaceRequests(fetch)[0];
  expect(url).toBe('/api/workspaces'); expect(JSON.parse(request.body as string)).toEqual({ machineId: 'local', path: '/project', label: 'Project' });
  expect(request.headers).toMatchObject({ 'Idempotency-Key': expect.any(String) });
});
it('reports an uncertain mutation and preserves its operation key instead of replaying a new effect', async () => {
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ state: 'unknown' }) })); vi.stubGlobal('fetch', fetch);
  const created = vi.fn(); render(<CreateWorkspace machineId="local" onCreated={created} />);
  const user = userEvent.setup(); await user.type(screen.getByLabelText('Project folder'), '/project'); await user.type(screen.getByLabelText('Workspace name'), 'Project');
  await user.click(screen.getByRole('button', { name: 'Create workspace' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('not known'));
  expect(workspaceRequests(fetch)).toHaveLength(1); expect(created).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Create workspace' }));
  await waitFor(() => expect(workspaceRequests(fetch)).toHaveLength(2));
  const requests = workspaceRequests(fetch);
  expect(requests[1][1].headers).toEqual(requests[0][1].headers);
});
it('completes a typed folder prefix from server suggestions with Tab', async () => {
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ['~/src/', '~/srv/'] })); vi.stubGlobal('fetch', fetch);
  render(<CreateWorkspace machineId="local" onCreated={() => {}} />);
  const user = userEvent.setup(); const input = screen.getByLabelText('Project folder') as HTMLInputElement;
  await user.type(input, '~/sr'); await screen.findByRole('listbox');
  await user.keyboard('{ArrowDown}{Tab}');
  expect(input.value).toBe('~/srv/');
});
it('accepts the highlighted folder on Enter and closes the dropdown without submitting', async () => {
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ['~/src/', '~/srv/'] })); vi.stubGlobal('fetch', fetch);
  render(<CreateWorkspace machineId="local" onCreated={() => {}} />);
  const user = userEvent.setup(); const input = screen.getByLabelText('Project folder') as HTMLInputElement;
  await user.type(input, '~/sr'); await screen.findByRole('listbox');
  await user.keyboard('{Enter}');
  expect(input.value).toBe('~/src/'); expect(screen.queryByRole('listbox')).toBeNull(); expect(workspaceRequests(fetch)).toHaveLength(0);
});
