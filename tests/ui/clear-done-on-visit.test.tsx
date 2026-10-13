import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { useClearDoneOnVisit } from '../../src/client/clear-done-on-visit';
import { exampleThreads, type Thread } from '../../src/lib/models';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const thread = (overrides: Partial<Thread> = {}): Thread => ({ ...exampleThreads()[0], ...overrides });
const done = () => thread({ status: 'done', unseenDone: true, doneAt: '2026-10-14T00:00:00.000Z' });
const render = (props: { t: Thread | undefined; pane: string; on: boolean }) =>
  renderHook(({ t, pane, on }) => useClearDoneOnVisit(t, pane, on), { initialProps: props });

it('posts focus once for a latched done thread with a pane while enabled', async () => {
  const fetch = vi.fn(async () => ({ ok: true }));
  vi.stubGlobal('fetch', fetch);
  const { rerender } = render({ t: done(), pane: 'w1:p1', on: true });
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  expect(fetch.mock.calls[0][0]).toBe(`/api/threads/${encodeURIComponent(done().id)}/focus`);
  expect(JSON.parse(String(fetch.mock.calls[0][1].body))).toEqual({ machineId: 'local', paneId: 'w1:p1' });
  rerender({ t: done(), pane: 'w1:p1', on: true });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('does not post for live done without latch, without pane, or when disabled', async () => {
  const fetch = vi.fn(async () => ({ ok: true }));
  vi.stubGlobal('fetch', fetch);
  const seen = thread({ status: 'done', unseenDone: false });
  const { rerender } = render({ t: seen, pane: 'w1:p1', on: true });
  rerender({ t: done(), pane: '', on: true });
  rerender({ t: done(), pane: 'w1:p1', on: false });
  rerender({ t: undefined, pane: 'w1:p1', on: true });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(fetch).not.toHaveBeenCalled();
});

it('retries when re-enabled after a failed post', async () => {
  const fetch = vi.fn(async () => { throw new Error('down'); });
  vi.stubGlobal('fetch', fetch);
  const { rerender } = render({ t: done(), pane: 'w1:p1', on: true });
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  rerender({ t: done(), pane: 'w1:p1', on: false });
  rerender({ t: done(), pane: 'w1:p1', on: true });
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
});
