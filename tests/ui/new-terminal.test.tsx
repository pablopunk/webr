import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { navigate } from 'astro:transitions/client';
import { Sidebar } from '../../src/components/Sidebar';
import { exampleThreads, projects } from '../../src/lib/models';
import type { Machine } from '../../src/lib/machines';

vi.mock('astro:transitions/client', () => ({ navigate: vi.fn() }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
const machine: Machine = { id: 'local', name: 'Local', connected: true, writable: true, session: 'default', projectPaths: {}, harnesses: [] };
const project = { ...projects[0], machineId: machine.id };
const fetch = vi.fn(async (url: string, _request: RequestInit) => ({ ok: true, json: async () => url === '/api/terminals' ? { tabId: 'w2:t1' } : [] }));
const renderSidebar = (mode: 'threads' | 'projects' = 'threads', machines: Machine[] = [machine]) => render(
  <QueryClientProvider client={new QueryClient()}>
    <Sidebar projects={mode === 'projects' ? [project] : []} threads={exampleThreads().slice(0, 1)} machines={machines} currentMachineId={machines[0]?.id} mode={mode} onModeChange={() => {}} collapsed={false} mobileOpen={false} onCollapse={() => {}} onCloseMobile={() => {}} />
  </QueryClientProvider>,
);

it('opens a shell-only terminal at the home directory from the icon-only launcher', async () => {
  vi.stubGlobal('fetch', fetch); renderSidebar();
  const button = screen.getByRole('button', { name: 'New Terminal' });
  expect(button.textContent).toBe('');
  fireEvent.click(button);
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/sessions/default/tabs/w2%3At1?machine=local'));
  const [url, request] = fetch.mock.calls.find(([url]) => url === '/api/terminals')!;
  expect(url).toBe('/api/terminals');
  expect(JSON.parse(String(request.body))).toEqual({ machineId: 'local', path: '~/' });
  expect(request.headers).toMatchObject({ 'Idempotency-Key': expect.any(String) });
});

it('opens a terminal at the project path from its context menu', async () => {
  vi.stubGlobal('fetch', fetch); renderSidebar('projects');
  fireEvent.contextMenu(screen.getByRole('button', { name: 'herdr' }));
  expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual(['New thread', 'New Terminal', 'Rename project', 'Change icon']);
  fireEvent.click(await screen.findByRole('menuitem', { name: 'New Terminal' }));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/sessions/default/tabs/w2%3At1?machine=local'));
  const [url, request] = fetch.mock.calls.find(([url]) => url === '/api/terminals')!;
  expect(url).toBe('/api/terminals');
  expect(JSON.parse(String(request.body))).toEqual({ machineId: 'local', path: project.path });
});

it('disables the home terminal launcher without a writable machine', () => {
  renderSidebar('threads', []);
  expect((screen.getByRole('button', { name: 'New Terminal' }) as HTMLButtonElement).disabled).toBe(true);
});
