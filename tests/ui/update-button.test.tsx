import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UpdateButton } from '../../src/components/UpdateButton';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const status = (overrides = {}) => ({ current: '1.0.0', latest: '1.1.0', available: true, state: 'idle', ...overrides });
const json = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init);
const renderButton = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><UpdateButton /></QueryClientProvider>);

it('shows nothing when no newer version exists', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json(status({ available: false }))));
  renderButton();
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  expect(screen.queryByRole('button', { name: /update/i })).toBeNull();
});

it('asks for confirmation, starts the update and reloads once the new version answers', async () => {
  let updating = false;
  const reload = vi.fn();
  vi.stubGlobal('location', { ...window.location, reload });
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') { updating = true; return json(status({ state: 'updating' }), { status: 202 }); }
    return json(updating ? status({ current: '1.1.0', available: false }) : status());
  });
  vi.stubGlobal('fetch', fetchMock);
  renderButton();
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Update' }));
  expect(await screen.findByText(/Update Webr from 1\.0\.0 to 1\.1\.0/)).toBeTruthy();
  await userEvent.setup().click(screen.getAllByRole('button', { name: 'Update' }).at(-1)!);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/update', { method: 'POST' }));
  await waitFor(() => expect(reload).toHaveBeenCalled(), { timeout: 5000 });
});
