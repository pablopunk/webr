import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Sidebar } from '../../src/components/Sidebar';
import { exampleThreads } from '../../src/lib/models';
import type { FloatingTab } from '../../src/lib/floating';

vi.mock('astro:transitions/client', () => ({ navigate: vi.fn() }));
vi.mock('../../src/components/dialogs', () => ({ confirmDialog: vi.fn(async () => true), alertDialog: vi.fn(async () => {}) }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const floating: FloatingTab[] = [{ machineId: 'local', session: 'default', tabId: 'w1:t9', workspaceId: 'w1', label: 'Floating shell', paneCount: 2, panes: [] }];
const machines = [{ id: 'local', name: 'Local', connected: true, session: 'default', projectPaths: {}, harnesses: [], writable: true }];

const renderSidebar = () => render(<Sidebar projects={[]} threads={exampleThreads().slice(0, 1)} floating={floating} machines={machines} currentTab={{ machineId: 'local', tabId: 'w1:t9' }} mode="threads" onModeChange={() => {}} collapsed={false} mobileOpen={false} onCollapse={() => {}} onCloseMobile={() => {}} />);

it('lists threads and terminals in one navigation with a terminals divider', () => {
  renderSidebar();
  expect(screen.getByRole('link', { name: /Build the web terminal bridge/ })).toBeTruthy();
  expect(screen.getByRole('link', { name: /Floating shell/ }).getAttribute('href')).toBe('/sessions/default/tabs/w1%3At9?machine=local');
  expect(screen.getByText('Terminals')).toBeTruthy();
  expect(screen.getByRole('link', { name: /Floating shell/ }).getAttribute('aria-current')).toBe('page');
});

it('closes a terminal after confirming a busy process', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ closed: false, busy: true }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ closed: true, busy: false }) });
  vi.stubGlobal('fetch', fetch);
  renderSidebar();
  fireEvent.click(screen.getByRole('button', { name: 'Close Floating shell' }));
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(fetch.mock.calls[0][0]).toBe('/api/tabs/close');
  expect(JSON.parse(String(fetch.mock.calls[0][1].body))).toEqual({ machineId: 'local', tabId: 'w1:t9', force: false });
  expect(JSON.parse(String(fetch.mock.calls[1][1].body))).toEqual({ machineId: 'local', tabId: 'w1:t9', force: true });
});
