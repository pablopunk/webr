import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UpdateSetting } from '../../src/components/UpdateSetting';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const status = { current: '1.0.0', latest: '1.0.0', available: false, state: 'idle' };
const json = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init);

it('confirms, restarts the server and reloads once it answers again', async () => {
  let restarted = false;
  let calls = 0;
  const reload = vi.fn();
  vi.stubGlobal('location', { ...window.location, reload });
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/restart') { restarted = true; return json(status, { status: 202 }); }
    if (restarted && ++calls === 1) throw new TypeError('server down');
    return json(status);
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><UpdateSetting /></QueryClientProvider>);
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Restart server' }));
  await userEvent.setup().click(screen.getAllByRole('button', { name: 'Restart' }).at(-1)!);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/restart', { method: 'POST' }));
  await waitFor(() => expect(reload).toHaveBeenCalled(), { timeout: 5000 });
});
