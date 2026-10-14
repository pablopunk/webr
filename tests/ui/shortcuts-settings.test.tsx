import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SettingsView } from '../../src/components/SettingsView';

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

const keymap = {
  prefix: 'ctrl+a',
  prefixes: ['ctrl+a'],
  bindings: {
    next_tab: ['shift+right'],
    previous_tab: ['shift+left'],
    focus_pane_right: ['ctrl+l'],
    focus_pane_left: ['ctrl+h'],
    focus_pane_down: ['ctrl+j'],
    focus_pane_up: ['ctrl+k'],
    toggle_sidebar: ['ctrl+a b'],
    new_tab: ['ctrl+a c'],
    rename_workspace: ['ctrl+a r'],
    split_vertical: ['ctrl+a v'],
    close_pane: ['ctrl+a x'],
  },
  stock: { close_pane: ['ctrl+a x'], rename_tab: ['ctrl+a shift+t'], rename_workspace: ['ctrl+a shift+w'] },
};

const json = (body: unknown) => new Response(JSON.stringify(body));
const stubFetch = () => vi.stubGlobal('fetch', vi.fn(async (url: string) => {
  if (url === '/api/herdr-keys') return json(keymap);
  if (url === '/api/update') return json({ current: '1.0.0', latest: '1.0.0', available: false, state: 'idle' });
  if (url === '/api/remote/tailscale') return json({ status: 'unavailable' });
  if (url === '/api/pair/pending') return json([]);
  if (url === '/api/devices') return json([]);
  if (url === '/api/audit') return json([]);
  throw new Error('unexpected fetch ' + url);
}));

const renderSettings = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <SettingsView onOpenSidebar={() => {}} />
  </QueryClientProvider>,
);

// Triggers render kbd chips, so assert on their concatenated text.
const triggerText = (name: string) => screen.getByRole('combobox', { name }).textContent;

it('defaults each action to the Herdr binding, prefix included', async () => {
  stubFetch();
  renderSettings();
  await waitFor(() => expect(screen.getByText(/\(⌃A prefix\)/)).toBeTruthy());
  expect(triggerText('Close pane shortcut: Close pane')).toBe('⌃A›X');
  expect(triggerText('Next thread shortcut: Focus pane down')).toBe('⌃J');
  expect(triggerText('Previous thread shortcut: Focus pane up')).toBe('⌃K');
  expect(triggerText('Leader prefix: Herdr')).toBe('⌃A');
  expect(triggerText('Rename thread shortcut: Rename workspace')).toBe('⌃A›R');
});

it('reset restores the Herdr bindings over custom overrides', async () => {
  stubFetch();
  localStorage.setItem('webr-shortcuts', JSON.stringify({ closePane: 'ctrl+q' }));
  renderSettings();
  await waitFor(() => expect(triggerText('Close pane shortcut: Custom')).toBe('⌃Q'));
  fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
  await waitFor(() => expect(triggerText('Close pane shortcut: Close pane')).toBe('⌃A›X'));
});

it('rebases Herdr bindings onto a custom prefix', async () => {
  stubFetch();
  localStorage.setItem('webr-shortcut-prefix', 'ctrl+space');
  renderSettings();
  await waitFor(() => expect(screen.getByText(/\(⌃Space prefix\)/)).toBeTruthy());
  expect(triggerText('Leader prefix: Custom')).toBe('⌃Space');
  expect(triggerText('Close pane shortcut: Close pane')).toBe('⌃Space›X');
});
