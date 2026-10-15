import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Sidebar } from '../../src/components/Sidebar';
import { exampleThreads } from '../../src/lib/models';

vi.mock('astro:transitions/client', () => ({ navigate: vi.fn() }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const renderSidebar = (threads = exampleThreads().slice(0, 1), archived = exampleThreads().slice(1, 2).map((thread) => ({ ...thread, archivedAt: thread.updatedAt }))) => {
  const machineIds = [...new Set([...threads, ...archived].map((thread) => thread.machineId))];
  const machines = machineIds.map((id) => ({ id, name: 'Local', connected: true, session: 'default', projectPaths: {}, harnesses: [], writable: true }));
  return render(<Sidebar projects={[]} threads={threads} archived={archived} machines={machines} mode="threads" onModeChange={() => {}} collapsed={false} mobileOpen={false} onCollapse={() => {}} onCloseMobile={() => {}} />);
};
const answering = () => vi.fn(async (_path: string, _init: RequestInit) => ({ ok: true, json: async () => ({ deleted: 1, orphanTabsDeleted: 0, failed: [], skippedMachines: [] }) }));
const requestsFor = (fetch: ReturnType<typeof answering>, endpoint: string) => fetch.mock.calls.filter(([path]) => path === endpoint);

it('archives a thread from its hover button and restores it from the Archived section', async () => {
  const fetch = answering(); vi.stubGlobal('fetch', fetch); renderSidebar();
  fireEvent.click(screen.getByRole('button', { name: 'Archive Build the web terminal bridge' }));
  const archiveEndpoint = '/api/threads/terminal-web-bridge/archive';
  expect(JSON.parse(String(requestsFor(fetch, archiveEndpoint)[0]?.[1].body))).toEqual({ machineId: 'local', archived: true });
  expect(screen.queryByRole('button', { name: 'Unarchive Review socket API changes' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Archived/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Unarchive Review socket API changes' }));
  expect(fetch.mock.calls.filter(([path]) => path.endsWith('/archive')).map(([, init]) => JSON.parse(String(init.body)))).toEqual([
    { machineId: 'local', archived: true },
    { machineId: 'local', archived: false },
  ]);
});
it('deletes permanently from the right-click menu and deletes all archived threads after confirmation', async () => {
  const fetch = answering(); vi.stubGlobal('fetch', fetch); renderSidebar(exampleThreads().slice(0, 1).map((thread) => ({ ...thread, ownsWorktree: true })));
  fireEvent.contextMenu(screen.getByRole('link', { name: /Build the web terminal bridge/ }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete permanently' }));
  expect(await screen.findByText(/removes its worktree/)).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(requestsFor(fetch, '/api/threads/terminal-web-bridge/delete')).toHaveLength(1));
  fireEvent.click(screen.getByRole('button', { name: 'Delete all' }));
  expect(await screen.findByText(/Standalone terminal tabs and agents not represented as threads are also closed/)).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: 'Delete all', hidden: false }).then(() => screen.getAllByRole('button', { name: 'Delete all' }).at(-1)!));
  await waitFor(() => expect(requestsFor(fetch, '/api/archive/delete')).toHaveLength(1));
});
it('renames a thread in place after a double click and keeps the old name on Escape', async () => {
  const fetch = answering(); vi.stubGlobal('fetch', fetch); renderSidebar();
  fireEvent.doubleClick(screen.getByRole('link', { name: /Build the web terminal bridge/ }));
  const input = screen.getByRole('textbox', { name: 'Rename Build the web terminal bridge' });
  fireEvent.change(input, { target: { value: '  Bridge v2 ' } }); fireEvent.keyDown(input, { key: 'Enter' });
  const renameEndpoint = '/api/threads/terminal-web-bridge/rename';
  expect(JSON.parse(String(requestsFor(fetch, renameEndpoint)[0]?.[1].body))).toEqual({ machineId: 'local', title: 'Bridge v2' });
  fireEvent.doubleClick(screen.getByRole('link', { name: /Build the web terminal bridge/ }));
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
  expect(screen.queryByRole('textbox')).toBeNull(); expect(requestsFor(fetch, renameEndpoint)).toHaveLength(1);
});
it('renames the current thread when asked through the rename event', async () => {
  const fetch = answering(); vi.stubGlobal('fetch', fetch);
  render(<Sidebar projects={[]} threads={exampleThreads().slice(0, 1)} archived={[]} machines={[]} mode="threads" onModeChange={() => {}} collapsed={false} mobileOpen={false} onCollapse={() => {}} onCloseMobile={() => {}} currentId="terminal-web-bridge" />);
  expect(screen.queryByRole('textbox')).toBeNull();
  window.dispatchEvent(new CustomEvent('webr:rename-thread', { detail: 'no-such-thread' }));
  expect(screen.queryByRole('textbox')).toBeNull();
  window.dispatchEvent(new CustomEvent('webr:rename-thread', { detail: 'terminal-web-bridge' }));
  expect(await screen.findByRole('textbox', { name: 'Rename Build the web terminal bridge' })).toBeTruthy();
});
it('shows the palette shortcut on its footer button', () => {
  render(<Sidebar projects={[]} threads={exampleThreads().slice(0, 1)} archived={[]} machines={[]} mode="threads" onModeChange={() => {}} collapsed={false} mobileOpen={false} onCollapse={() => {}} onCloseMobile={() => {}} paletteShortcut="ctrl+a p" />);
  expect(screen.getByRole('button', { name: 'Open command palette (⌃A P)' })).toBeTruthy();
});
it('keeps internal recovery state out of sidebar labels', () => {
  const thread = { ...exampleThreads()[0], providerSession: { source: 'herdr', agent: 'claude', kind: 'id' as const, value: 'session-1' }, recovery: { state: 'needs_attention' as const, reason: 'conversation_missing' } };
  renderSidebar([thread], []);
  const row = screen.getByRole('link', { name: /Build the web terminal bridge/ });
  expect(row.getAttribute('aria-label')).not.toMatch(/session|recovery|provider|checkout/i);
  expect(screen.queryByText(/Session verified|Session unverified|Recovery needs attention/i)).toBeNull();
});
