import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NewThreadView } from '../../src/components/NewThreadView';

vi.mock('astro:transitions/client', () => ({ navigate: vi.fn() }));
vi.mock('../../src/client/catalog', () => ({ useMachineCatalog: (_id: string, _connected: boolean, _version: number, _session: string, projectId: string) => ({
  data: { isGitRepo: true, harnesses: projectId === 'local:second' ? [
    { id: 'codex', name: 'Codex', models: ['Default'], launchEnabled: true },
    { id: 'claude', name: 'Claude Code', models: ['Default'], launchEnabled: true },
  ] : [
    { id: 'claude', name: 'Claude Code', models: ['Default'], launchEnabled: true },
    { id: 'codex', name: 'Codex', models: ['Default'], launchEnabled: true },
  ] }, isError: false,
}) }));

const projects = [
  { id: 'local:first', name: 'First', path: '/first', color: '#555', initial: 'F' },
  { id: 'local:second', name: 'Second', path: '/second', color: '#555', initial: 'S' },
];
const machines = [{ id: 'local', name: 'Local', connected: true, writable: true, session: 'default', projectPaths: { 'local:first': '/first', 'local:second': '/second' }, harnesses: [] }];
const show = () => render(<NewThreadView projects={projects} machines={machines} onOpenSidebar={() => {}} />);

afterEach(() => { cleanup(); localStorage.clear(); });

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

it('updates the worktree tooltip when the checkout mode changes', async () => {
  show();
  const user = userEvent.setup();
  const checkbox = screen.getByRole('checkbox', { name: 'Create a new worktree' });
  await user.hover(checkbox);
  expect(await screen.findByText('new worktree')).toBeTruthy();
  await user.click(checkbox); await user.unhover(checkbox); await user.hover(checkbox);
  expect(await screen.findByText('current checkout')).toBeTruthy();
  await user.click(checkbox); await user.unhover(checkbox); await user.hover(checkbox);
  expect(await screen.findByText('new worktree')).toBeTruthy();
});
