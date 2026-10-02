import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Sidebar } from '../../src/components/Sidebar';
import { exampleThreads } from '../../src/lib/models';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const renderSidebar = (threads = exampleThreads().slice(0, 1), archived = exampleThreads().slice(1, 2).map((thread) => ({ ...thread, archivedAt: thread.updatedAt }))) => render(<Sidebar projects={[]} threads={threads} archived={archived} machines={[]} mode="threads" onModeChange={() => {}} collapsed={false} mobileOpen={false} onCollapse={() => {}} onCloseMobile={() => {}} />);
const answering = () => vi.fn(async (_path: string, _init: RequestInit) => ({ ok: true, json: async () => ({ deleted: 1, failed: [] }) }));

it('archives a thread from its hover button and restores it from the Archived section', async () => {
  const fetch = answering(); vi.stubGlobal('fetch', fetch); renderSidebar();
  fireEvent.click(screen.getByRole('button', { name: 'Archive Build the web terminal bridge' }));
  expect(fetch.mock.calls[0][0]).toBe('/api/threads/terminal-web-bridge/archive'); expect(JSON.parse(String(fetch.mock.calls[0][1].body))).toEqual({ machineId: 'local', archived: true });
  expect(screen.queryByRole('button', { name: 'Unarchive Review socket API changes' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Archived/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Unarchive Review socket API changes' }));
  expect(JSON.parse(String(fetch.mock.calls[1][1].body))).toEqual({ machineId: 'local', archived: false });
});
it('deletes permanently from the right-click menu and deletes all archived threads after confirmation', async () => {
  const fetch = answering(); vi.stubGlobal('fetch', fetch); vi.stubGlobal('confirm', vi.fn(() => true)); renderSidebar();
  fireEvent.contextMenu(screen.getByRole('link', { name: /Build the web terminal bridge/ }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete permanently' }));
  await waitFor(() => expect(fetch.mock.calls[0][0]).toBe('/api/threads/terminal-web-bridge/delete'));
  fireEvent.click(screen.getByRole('button', { name: 'Delete all' }));
  await waitFor(() => expect(fetch.mock.calls[1][0]).toBe('/api/archive/delete'));
  expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining('removes its worktree, including uncommitted changes'));
});
