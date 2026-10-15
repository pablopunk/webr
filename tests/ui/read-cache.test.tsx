import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { machineCatalogQueryKey, useMachineCatalog } from '../../src/client/catalog';
import { directorySuggestionsQueryKey } from '../../src/client/directory-suggestions';
import { CreateWorkspace } from '../../src/components/CreateWorkspace';
import { LaunchSelectors } from '../../src/components/LaunchSelectors';
import { OpenWorktree } from '../../src/components/OpenWorktree';
import type { Machine } from '../../src/lib/machines';
import type { Project } from '../../src/lib/models';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
const project: Project = { id: 'project-1', machineId: 'machine-1', name: 'Project One', path: '/project', color: '#555', initial: 'P', metadataVersion: 0 };
const machine: Machine = { id: 'machine-1', name: 'Machine One', connected: true, session: 'session-1', configVersion: 1, projectPaths: { [project.id]: project.path }, harnesses: [] };
const harness = { id: 'claude', name: 'Claude Code', models: ['Default'], launchEnabled: true };
const catalog = { ...machine, harnesses: [harness] };
const tree = { path: '/project/worktrees/feature', branch: 'feature', label: 'Feature' };
const worktreeKey = ['worktrees', '', machine.id, project.id] as const;
const createQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

async function openWorktreeMenu(queryClient: QueryClient) {
  const user = userEvent.setup();
  render(<QueryClientProvider client={queryClient}><OpenWorktree projects={[project]} /></QueryClientProvider>);
  await user.click(screen.getByRole('button', { name: 'Open existing worktree' }));
  await user.hover(await screen.findByRole('menuitem', { name: /Project One/ }));
  return user;
}
function CatalogBackedSelectors() {
  const catalogQuery = useMachineCatalog(machine.id, machine.connected, machine.configVersion, machine.session, project.id);
  return <LaunchSelectors machine={machine} machines={[machine]} projects={[project]} projectId={project.id} harness="claude" catalog={catalogQuery} onMachineChange={() => {}} onProjectChange={() => {}} onHarnessChange={() => {}} />;
}
function renderLaunchSelectors(queryClient: QueryClient) {
  return render(<QueryClientProvider client={queryClient}><CatalogBackedSelectors /></QueryClientProvider>);
}

it('shows a cached worktree immediately while its stale query is still pending', async () => {
  const queryClient = createQueryClient();
  queryClient.setQueryData(worktreeKey, [tree], { updatedAt: 0 });
  const pending = deferred<Response>();
  const fetch = vi.fn(() => pending.promise);
  vi.stubGlobal('fetch', fetch);

  await openWorktreeMenu(queryClient);
  expect(await screen.findByText('feature')).toBeTruthy();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('retains cached worktrees and reports a subtle warning after refresh failure', async () => {
  const queryClient = createQueryClient();
  queryClient.setQueryData(worktreeKey, [tree], { updatedAt: 0 });
  vi.stubGlobal('fetch', vi.fn(async () => response({ error: 'unavailable' }, 503)));

  await openWorktreeMenu(queryClient);
  expect((await screen.findByRole('status')).textContent).toContain('Could not refresh worktrees. Showing cached results.');
  expect(screen.getByText('feature')).toBeTruthy();
});

it('shows loading rather than an empty worktree state on a cold query', async () => {
  const queryClient = createQueryClient();
  const pending = deferred<Response>();
  vi.stubGlobal('fetch', vi.fn(() => pending.promise));

  await openWorktreeMenu(queryClient);
  expect(await screen.findByRole('status', { name: 'Loading worktrees' })).toBeTruthy();
  expect(screen.queryByText('Every worktree already has a thread')).toBeNull();
});

it('shows a cached harness immediately while refreshing', async () => {
  const queryClient = createQueryClient();
  queryClient.setQueryData(machineCatalogQueryKey(machine.id, machine.configVersion!, machine.session, project.id, ''), catalog, { updatedAt: 0 });
  const pending = deferred<Response>();
  vi.stubGlobal('fetch', vi.fn(() => pending.promise));

  const user = userEvent.setup();
  renderLaunchSelectors(queryClient);
  await user.click(screen.getByRole('combobox', { name: /Harness/ }));
  expect(await screen.findByRole('option', { name: 'Claude Code' })).toBeTruthy();
});

it('retains cached harnesses and shows a refresh warning after a failed refetch', async () => {
  const queryClient = createQueryClient();
  queryClient.setQueryData(machineCatalogQueryKey(machine.id, machine.configVersion!, machine.session, project.id, ''), catalog, { updatedAt: 0 });
  vi.stubGlobal('fetch', vi.fn(async () => response({ error: 'unavailable' }, 503)));

  const user = userEvent.setup();
  renderLaunchSelectors(queryClient);
  await user.click(screen.getByRole('combobox', { name: /Harness/ }));
  expect(await screen.findByText('Could not refresh harness options. Showing cached results.')).toBeTruthy();
  expect(screen.getByRole('option', { name: 'Claude Code' })).toBeTruthy();
});

it('keeps a cached empty harness state distinct from a cold load failure', async () => {
  const queryClient = createQueryClient();
  queryClient.setQueryData(machineCatalogQueryKey(machine.id, machine.configVersion!, machine.session, project.id, ''), { ...machine, harnesses: [] }, { updatedAt: 0 });
  vi.stubGlobal('fetch', vi.fn(async () => response({ error: 'unavailable' }, 503)));

  const user = userEvent.setup();
  renderLaunchSelectors(queryClient);
  await user.click(screen.getByRole('combobox', { name: /Harness/ }));
  expect(await screen.findByText('Could not refresh harness options. Showing cached results.')).toBeTruthy();
  expect(screen.getByText('No harnesses available.')).toBeTruthy();
  expect(screen.queryByText('Could not load harnesses.')).toBeNull();
});

it('shows a loading state rather than an empty harness list on a cold query', async () => {
  const queryClient = createQueryClient();
  const pending = deferred<Response>();
  vi.stubGlobal('fetch', vi.fn(() => pending.promise));

  const user = userEvent.setup();
  renderLaunchSelectors(queryClient);
  await user.click(screen.getByRole('combobox', { name: /Harness/ }));
  expect(await screen.findByRole('status', { name: 'Loading harness' })).toBeTruthy();
  expect(screen.queryByText('No harnesses available.')).toBeNull();
});

it('does not let a late directory response replace suggestions for the current prefix', async () => {
  const queryClient = createQueryClient();
  const oldResponse = deferred<Response>();
  const currentResponse = deferred<Response>();
  const fetch = vi.fn()
    .mockReturnValueOnce(oldResponse.promise)
    .mockReturnValueOnce(currentResponse.promise);
  vi.stubGlobal('fetch', fetch);
  render(<QueryClientProvider client={queryClient}><CreateWorkspace machineId={machine.id} session={machine.session} configVersion={machine.configVersion} onCreated={() => {}} /></QueryClientProvider>);

  const input = screen.getByRole('combobox', { name: 'Project folder' });
  fireEvent.change(input, { target: { value: '/old' } });
  fireEvent.change(input, { target: { value: '/current' } });
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

  await act(async () => { currentResponse.resolve(response(['/current-project/'])); });
  expect(await screen.findByRole('option', { name: '/current-project/' })).toBeTruthy();
  await act(async () => { oldResponse.resolve(response(['/old-project/'])); });
  expect(screen.getByRole('option', { name: '/current-project/' })).toBeTruthy();
  expect(screen.queryByRole('option', { name: '/old-project/' })).toBeNull();
});

it('isolates catalog and directory suggestions by target identity, configuration, session, project, prefix, and account scope', () => {
  const catalogKey = machineCatalogQueryKey('machine-1', 1, 'session-1', 'project-1', 'account-a');
  expect(machineCatalogQueryKey('machine-1', 1, 'session-1', 'project-2', 'account-a')).not.toEqual(catalogKey);
  expect(machineCatalogQueryKey('machine-1', 2, 'session-1', 'project-1', 'account-a')).not.toEqual(catalogKey);
  expect(machineCatalogQueryKey('machine-1', 1, 'session-2', 'project-1', 'account-a')).not.toEqual(catalogKey);
  expect(machineCatalogQueryKey('machine-2', 1, 'session-1', 'project-1', 'account-a')).not.toEqual(catalogKey);
  expect(machineCatalogQueryKey('machine-1', 1, 'session-1', 'project-1', 'account-b')).not.toEqual(catalogKey);
  const directoryKey = directorySuggestionsQueryKey('machine-1', 'session-1', 1, '/src', 'account-a');
  expect(directorySuggestionsQueryKey('machine-2', 'session-1', 1, '/src', 'account-a')).not.toEqual(directoryKey);
  expect(directorySuggestionsQueryKey('machine-1', 'session-2', 1, '/src', 'account-a')).not.toEqual(directoryKey);
  expect(directorySuggestionsQueryKey('machine-1', 'session-1', 1, '/other', 'account-a')).not.toEqual(directoryKey);
  expect(directorySuggestionsQueryKey('machine-1', 'session-1', 2, '/src', 'account-a')).not.toEqual(directoryKey);
  expect(directorySuggestionsQueryKey('machine-1', 'session-1', 1, '/src', 'account-b')).not.toEqual(directoryKey);
});
