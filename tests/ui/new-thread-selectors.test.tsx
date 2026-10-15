import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NewThreadView } from '../../src/components/NewThreadView';
import { writeLaunchDraft } from '../../src/client/new-thread-draft';

vi.mock('astro:transitions/client', () => ({ navigate: vi.fn() }));
vi.mock('../../src/client/catalog', () => ({ useMachineCatalog: (_id: string, _connected: boolean, _version: number, _session: string, projectId: string) => ({
  data: { isGitRepo: true, harnesses: projectId === 'local:second' ? [
    { id: 'codex', name: 'Codex', models: ['Default'], launchEnabled: true, integrationState: 'not_installed', recoveryWarning: 'Herdr integration is not installed. Conversation recovery may be unavailable.' },
    { id: 'claude', name: 'Claude Code', models: ['Default'], launchEnabled: true, integrationState: 'current' },
  ] : [
    { id: 'claude', name: 'Claude Code', models: ['Default'], launchEnabled: true, integrationState: 'current' },
    { id: 'codex', name: 'Codex', models: ['Default'], launchEnabled: true, integrationState: 'not_installed', recoveryWarning: 'Herdr integration is not installed. Conversation recovery may be unavailable.' },
  ] }, isError: false,
}) }));

const projects = [
  { id: 'local:first', name: 'First', path: '/first', color: '#555', initial: 'F', metadataVersion: 0 },
  { id: 'local:second', name: 'Second', path: '/second', color: '#555', initial: 'S', metadataVersion: 0 },
];
const machines = [{ id: 'local', name: 'Local', connected: true, writable: true, session: 'default', projectPaths: { 'local:first': '/first', 'local:second': '/second' }, harnesses: [] }];
const show = () => render(<NewThreadView projects={projects} machines={machines} onOpenSidebar={() => {}} />);

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); window.history.replaceState({}, '', '/'); });

it('keeps Add project inside the project menu and opens a cancelable form', async () => {
  show();
  const user = userEvent.setup();
  expect(screen.queryByRole('button', { name: 'Add project' })).toBeNull();
  expect(screen.queryByText('Select a verified launch adapter.')).toBeNull();
  await user.click(screen.getByRole('combobox', { name: /Project: First/ }));
  await user.click(await screen.findByRole('button', { name: 'Add project' }));
  expect(screen.getByRole('form', { name: 'Create workspace' })).toBeDefined();
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('textbox', { name: 'Thread prompt' })).toBeDefined();
});

it('restores the last harness independently for each project', async () => {
  show();
  const user = userEvent.setup();
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Harness: Claude Code' })).toBeDefined());
  await user.click(screen.getByRole('combobox', { name: 'Harness: Claude Code' }));
  await user.click(await screen.findByRole('option', { name: 'Codex' }));
  expect(localStorage.getItem('webr-last-harness:local:local:first')).toBe('codex');
  await user.click(screen.getByRole('combobox', { name: /Project: First/ }));
  await user.click(await screen.findByRole('option', { name: 'Second' }));
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Harness: Codex' })).toBeDefined());
  await user.click(screen.getByRole('combobox', { name: 'Harness: Codex' }));
  await user.click(await screen.findByRole('option', { name: 'Claude Code' }));
  await user.click(screen.getByRole('combobox', { name: /Project: Second/ }));
  await user.click(await screen.findByRole('option', { name: 'First' }));
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Harness: Codex' })).toBeDefined());
  expect(localStorage.getItem('webr-last-harness:local:local:second')).toBe('claude');
});

it('updates the worktree tooltip immediately when the checkout mode changes', async () => {
  show();
  const user = userEvent.setup();
  const checkbox = screen.getByRole('checkbox', { name: 'Create a new worktree' });
  await user.hover(checkbox);
  expect(screen.getByText('new worktree')).toBeTruthy();
  await user.click(checkbox); await user.unhover(checkbox); await user.hover(checkbox);
  expect(screen.getByText('current checkout')).toBeTruthy();
  await user.click(checkbox); await user.unhover(checkbox); await user.hover(checkbox);
  expect(screen.getByText('new worktree')).toBeTruthy();
});

it('creates a thread with the default model without exposing model selection', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ id: 'thread-1' }) } as Response);
  show();
  const user = userEvent.setup();
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Harness: Claude Code' })).toBeDefined());
  expect(screen.queryByRole('combobox', { name: /^Model:/ })).toBeNull();
  await user.type(screen.getByRole('textbox', { name: 'Thread prompt' }), 'Fix the bug');
  await user.click(screen.getByRole('button', { name: 'Create thread' }));
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  expect(JSON.parse(fetch.mock.calls[0][1]?.body as string)).toMatchObject({ agent: 'claude', model: 'Default' });
});
it('keeps harness options and composer free of integration and recovery status', async () => {
  show();
  const user = userEvent.setup();
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Harness: Claude Code' })).toBeDefined());
  expect(screen.queryByText(/integration is current|conversation recovery|integration is not installed/i)).toBeNull();
  await user.click(screen.getByRole('combobox', { name: 'Harness: Claude Code' }));
  expect((await screen.findByRole('option', { name: 'Claude Code' })).textContent).toBe('Claude Code');
  expect(screen.queryByText(/integration (current|missing|not installed|outdated|unavailable)|recovery/i)).toBeNull();
});

it('restores the submitted prompt, uploaded images, and launch choices after a failed launch', async () => {
  const prompt = 'Investigate this carefully. '.repeat(100);
  writeLaunchDraft('launch-1', {
    prompt, projectId: 'local:first', machineId: 'local', harness: 'codex', worktree: false,
    images: [{ id: 'image-1', name: 'failure.png', preview: 'data:image/jpeg;base64,AA==', path: '/uploads/failure.png' }],
  });
  window.history.replaceState({}, '', '/new?project=local%3Afirst&recover=launch-1');
  show();

  await waitFor(() => expect((screen.getByRole('textbox', { name: 'Thread prompt' }) as HTMLTextAreaElement).value).toBe(prompt));
  expect(screen.getByAltText('failure.png')).toBeDefined();
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Harness: Codex' })).toBeDefined());
  expect((screen.getByRole('checkbox', { name: 'Create a new worktree' }) as HTMLInputElement).checked).toBe(false);
  expect(new URL(window.location.href).searchParams.has('recover')).toBe(false);
  expect(localStorage.getItem('webr-launch-draft:launch-1')).toBeNull();
});
