import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Sidebar } from '../../src/components/Sidebar';
import { exampleThreads, projects } from '../../src/lib/models';
import type { Machine } from '../../src/lib/machines';
import { terminalStartupStorageKey } from '../../src/client/terminal-presets';
import { defaultThreadTickets } from '../../src/client/create-tickets';

const navigate = vi.fn((_url: string) => {});

afterEach(() => { cleanup(); defaultThreadTickets().clearOnAccessLoss(); vi.unstubAllGlobals(); vi.clearAllMocks(); sessionStorage.clear(); });
const machine: Machine = { id: 'local', name: 'Local', connected: true, writable: true, session: 'default', projectPaths: {}, harnesses: [] };
const project = { ...projects[0], machineId: machine.id };
const operationId = '44444444-4444-4444-8444-444444444444';
const fetch = vi.fn(async (url: string, request: RequestInit) => ({
  ok: true, status: 202,
  json: async () => url === '/api/terminals' ? {
    operationId, kind: 'terminal', state: 'unknown', step: 'workspace', statusUrl: `/api/operations/${operationId}`,
  } : [],
}));
const pendingKey = () => {
  const url = navigate.mock.calls.find(([value]) => value.startsWith('/new?resourcePending='))?.[0];
  return url ? new URL(url, 'http://localhost').searchParams.get('resourcePending')! : undefined;
};
const expectPendingCreate = async () => {
  await waitFor(() => expect(pendingKey()).toMatch(/^[0-9a-f-]{36}$/));
  await waitFor(() => expect(fetch.mock.calls.filter(([url]) => url === '/api/terminals')).toHaveLength(1));
  return defaultThreadTickets().getResource(pendingKey()!);
};
const renderSidebar = (mode: 'threads' | 'projects' = 'threads', machines: Machine[] = [machine]) => render(
  <QueryClientProvider client={new QueryClient()}>
    <Sidebar projects={mode === 'projects' ? [project] : []} threads={exampleThreads().slice(0, 1)} machines={machines} currentMachineId={machines[0]?.id} mode={mode} onModeChange={() => {}} collapsed={false} mobileOpen={false} onCollapse={() => {}} onCloseMobile={() => {}} onNavigate={navigate} />
  </QueryClientProvider>,
);

it('accepts a shell-only terminal from the icon-only launcher into a pending ticket', async () => {
  vi.stubGlobal('fetch', fetch); renderSidebar();
  const button = screen.getByRole('button', { name: 'New Terminal' });
  expect(button.textContent).toBe('');
  fireEvent.click(button);
  const ticket = await expectPendingCreate();
  expect(navigate).toHaveBeenCalledWith(`/new?resourcePending=${ticket!.key}`);
  expect(ticket).toMatchObject({ kind: 'terminal', session: 'default', normalizedPayload: { machineId: 'local', path: '~/' } });
  expect(ticket?.startupPreset).toBeUndefined();
  const [url, request] = fetch.mock.calls.find(([url]) => url === '/api/terminals')!;
  expect(url).toBe('/api/terminals');
  expect(JSON.parse(String(request.body))).toEqual({ machineId: 'local', path: '~/' });
  expect(request.headers).toMatchObject({ 'Idempotency-Key': ticket?.key });
});

it.each(['CPU', 'RAM'] as const)('stores the %s monitor preset on the terminal recovery ticket, not in an early side effect', async (metric) => {
  vi.stubGlobal('fetch', fetch); renderSidebar();
  fireEvent.click(screen.getByRole('button', { name: `Open ${metric} monitor terminal` }));
  const ticket = await expectPendingCreate();
  expect(navigate).toHaveBeenCalledWith(`/new?resourcePending=${ticket!.key}`);
  expect(ticket).toMatchObject({ kind: 'terminal', session: 'default', startupPreset: 'resource-monitor' });
  expect(sessionStorage.getItem(terminalStartupStorageKey('local', 'w2:t1'))).toBeNull();
  const [url, request] = fetch.mock.calls.find(([url]) => url === '/api/terminals')!;
  expect(url).toBe('/api/terminals');
  expect(JSON.parse(String(request.body))).toEqual({ machineId: 'local', path: '~/' });
});

it('accepts a terminal at the project path from its context menu', async () => {
  vi.stubGlobal('fetch', fetch); renderSidebar('projects');
  fireEvent.contextMenu(screen.getByRole('button', { name: 'herdr' }));
  expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual(['New thread', 'New Terminal', 'Rename project on Local', 'Change icon']);
  fireEvent.click(await screen.findByRole('menuitem', { name: 'New Terminal' }));
  const ticket = await expectPendingCreate();
  expect(navigate).toHaveBeenCalledWith(`/new?resourcePending=${ticket!.key}`);
  expect(ticket?.normalizedPayload).toEqual({ machineId: 'local', path: project.path });
  const [url, request] = fetch.mock.calls.find(([url]) => url === '/api/terminals')!;
  expect(url).toBe('/api/terminals');
  expect(JSON.parse(String(request.body))).toEqual({ machineId: 'local', path: project.path });
});

it('disables the home terminal launcher without a writable machine', () => {
  renderSidebar('threads', []);
  expect((screen.getByRole('button', { name: 'New Terminal' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Open CPU monitor terminal' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Open RAM monitor terminal' }) as HTMLButtonElement).disabled).toBe(true);
});
