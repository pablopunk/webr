import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { useClearDoneOnVisit } from '../../src/client/clear-done-on-visit';
import { exampleThreads, type Thread } from '../../src/lib/models';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const thread = (overrides: Partial<Thread> = {}): Thread => ({ ...exampleThreads()[0], ...overrides });
const done = () => thread({ status: 'done', unseenDone: true, doneAt: '2026-10-14T00:00:00.000Z' });
const render = (props: { t: Thread | undefined }) =>
  renderHook(({ t }) => useClearDoneOnVisit(t), { initialProps: props });

it('acknowledges a latched done thread as viewed without requiring a pane or writable control', async () => {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true }));
  vi.stubGlobal('fetch', fetch);
  const { rerender } = render({ t: done() });
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
  expect(url).toBe(`/api/threads/${encodeURIComponent(done().id)}/viewed`);
  expect(JSON.parse(String(init.body))).toEqual({ machineId: 'local' });
  rerender({ t: done() });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('does not post for live done without a latch', async () => {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true }));
  vi.stubGlobal('fetch', fetch);
  const seen = thread({ status: 'done', unseenDone: false });
  const { rerender } = render({ t: seen });
  rerender({ t: done() });
  rerender({ t: undefined });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(fetch).not.toHaveBeenCalled();
});

it('retries a failed viewed acknowledgement', async () => {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit): Promise<{ ok: boolean }> => {
    if (fetch.mock.calls.length === 1) throw new Error('down');
    return { ok: true };
  });
  vi.stubGlobal('fetch', fetch);
  render({ t: done() });
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2), { timeout: 3000 });
});
