import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Sidebar } from '../../src/components/Sidebar';
import { exampleThreads, type Thread } from '../../src/lib/models';
import { createRuntimeStore } from '../../src/client/store';
import { createPendingMetadataController, threadIsArchived, type PendingMetadataController } from '../../src/client/pending-metadata';
import type { Bootstrap } from '../../src/shared/runtime';
import { useStore } from 'zustand';

vi.mock('astro:transitions/client', () => ({ navigate: vi.fn() }));

const controllers: PendingMetadataController[] = [];
afterEach(() => { cleanup(); for (const controller of controllers.splice(0)) controller.dispose(); vi.unstubAllGlobals(); });
const renderSidebar = (threads = exampleThreads().slice(0, 1), archived = exampleThreads().slice(1, 2).map((thread) => ({ ...thread, archivedAt: thread.updatedAt }))) => {
  const machineIds = [...new Set([...threads, ...archived].map((thread) => thread.machineId))];
  const machines = machineIds.map((id) => ({ id, name: 'Local', connected: true, session: 'default', projectPaths: {}, harnesses: [], writable: true }));
  return render(<Sidebar projects={[]} threads={threads} archived={archived} machines={machines} mode="threads" onModeChange={() => {}} collapsed={false} mobileOpen={false} onCollapse={() => {}} onCloseMobile={() => {}} />);
};
const answering = () => vi.fn(async (path: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body)) as { machineId?: string; archived?: boolean; title?: string; name?: string; logicalId?: string };
  const entityId = decodeURIComponent(path.split('/').filter(Boolean)[2] ?? '');
  const metadata = { titleOverride: body.title ?? null, archivedAt: body.archived ? 'canonical-archive-time' : null };
  const value = path.endsWith('/archive') ? { entityId, metadataVersion: 1, metadata, archived: body.archived }
    : path.endsWith('/rename') && path.includes('/threads/') ? { entityId, metadataVersion: 1, metadata, title: body.title }
      : path === '/api/projects/rename' ? { machineId: body.machineId, entityId: body.logicalId, metadataVersion: 1, metadata: { name: body.name }, name: body.name }
        : { deleted: 1, orphanTabsDeleted: 0, failed: [], skippedMachines: [] };
  return { ok: true, status: 200, json: async () => value };
});
const requestsFor = (fetch: ReturnType<typeof answering>, endpoint: string) => fetch.mock.calls.filter(([path]) => path === endpoint);
const heldResponse = () => { let resolve!: (response: Response) => void; const promise = new Promise<Response>((yes) => { resolve = yes; }); return { promise, resolve }; };
function StoreSidebar({ runtime, metadata }: { runtime: ReturnType<typeof createRuntimeStore>; metadata: PendingMetadataController }) {
  const state = useStore(runtime);
  const all = state.threadIds.map((key) => state.threads[key]);
  const threads = all.filter((thread) => !threadIsArchived(thread, state.metadataFields));
  const archived = all.filter((thread) => threadIsArchived(thread, state.metadataFields));
  return <Sidebar projects={state.projectIds.map((key) => state.projects[key])} threads={threads} archived={archived} machines={[{ id: 'local', name: 'Local', connected: true, session: 'default', projectPaths: {}, harnesses: [], writable: true }]} mode="threads" onModeChange={() => {}} collapsed={false} mobileOpen={false} onCollapse={() => {}} onCloseMobile={() => {}} metadata={metadata} metadataFields={state.metadataFields} />;
}
function setupStoreSidebar(thread: Thread) {
  const projection = { machineId: thread.machineId, generation: 'generation-1', revision: 1, freshAt: null, connected: true, threads: [thread], projects: [], layouts: [] };
  const bootstrap: Bootstrap = { projections: [projection], machines: [{ id: thread.machineId, name: 'Local', connected: true, session: 'default', projectPaths: {}, harnesses: [], writable: true }], projects: [], threads: [thread], recoveryScope: 'sidebar-test' };
  const runtime = createRuntimeStore(bootstrap);
  const metadata = createPendingMetadataController(runtime, bootstrap.recoveryScope);
  controllers.push(metadata);
  return { runtime, metadata };
}

it('moves an optimistic archive into the Archived section while HTTP is held without inventing a timestamp', async () => {
  const thread = { ...exampleThreads()[0], archivedAt: undefined };
  const { runtime, metadata } = setupStoreSidebar(thread);
  const held = heldResponse(); vi.stubGlobal('fetch', vi.fn(() => held.promise));
  render(<StoreSidebar runtime={runtime} metadata={metadata} />);
  fireEvent.click(screen.getByRole('button', { name: 'Archive Build the web terminal bridge' }));
  expect(screen.queryByRole('link', { name: /Build the web terminal bridge/ })).toBeNull();
  expect(screen.getByRole('button', { name: /Archived/ }).textContent).toContain('1');
  fireEvent.click(screen.getByRole('button', { name: /Archived/ }));
  expect(screen.getByRole('button', { name: 'Unarchive Build the web terminal bridge' })).toBeTruthy();
  expect(runtime.getState().threads[JSON.stringify([thread.machineId, thread.id])].archivedAt).toBeUndefined();
  held.resolve({ ok: true, status: 200, json: async () => ({ entityId: thread.id, metadataVersion: 1, metadata: { titleOverride: null, archivedAt: 'server-canonical-time' }, archived: true }) } as Response);
  await waitFor(() => expect(runtime.getState().metadataFields[JSON.stringify(['thread', thread.machineId, thread.id, 'archived'])].status).toBe('saved'));
});

it('shows a renamed title in the Sidebar before its held HTTP response', async () => {
  const thread = { ...exampleThreads()[0], titleOverride: undefined };
  const { runtime, metadata } = setupStoreSidebar(thread);
  const held = heldResponse(); vi.stubGlobal('fetch', vi.fn(() => held.promise));
  render(<StoreSidebar runtime={runtime} metadata={metadata} />);
  fireEvent.doubleClick(screen.getByRole('link', { name: /Build the web terminal bridge/ }));
  const input = screen.getByRole('textbox', { name: 'Rename Build the web terminal bridge' });
  fireEvent.change(input, { target: { value: 'Instant sidebar title' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(await screen.findByRole('link', { name: /Instant sidebar title/ })).toBeTruthy();
  expect(runtime.getState().confirmedThreads[JSON.stringify([thread.machineId, thread.id])].titleOverride).toBeUndefined();
  held.resolve({ ok: true, status: 200, json: async () => ({ entityId: thread.id, metadataVersion: 1, metadata: { titleOverride: 'Instant sidebar title', archivedAt: null }, title: 'Instant sidebar title' }) } as Response);
  await waitFor(() => expect(runtime.getState().metadataFields[JSON.stringify(['thread', thread.machineId, thread.id, 'titleOverride'])].status).toBe('saved'));
});

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
