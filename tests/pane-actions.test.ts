import { afterEach, expect, it, vi } from 'vitest';
import { closeThreadPane, openThreadTerminal, PaneActionError } from '../src/client/thread-actions';
import { exampleThreads } from '../src/lib/models';

afterEach(() => vi.unstubAllGlobals());
const thread = { ...exampleThreads()[0]!, machineId: 'machine/one', id: 'thread one' };
const response = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

it('posts a split once with the real target and accepts only a returned native pane ID', async () => {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response(200, { paneId: 'native-pane' })); vi.stubGlobal('fetch', fetchMock);
  await expect(openThreadTerminal(thread, 'native-source')).resolves.toEqual({ paneId: 'native-pane' });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/threads/thread%20one/panes/terminal');
  expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({ machineId: 'machine/one', afterPaneId: 'native-source' });
});

it('classifies pre-effect refusals as definitive and transport/server outcomes as uncertain without replay', async () => {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response(200, {}));
  fetchMock.mockImplementationOnce(async () => response(404, { error: 'thread_not_found' }))
    .mockImplementationOnce(async () => response(503, { error: 'pane_outcome_unknown' }))
    .mockImplementationOnce(async () => response(409, { error: 'pane_action_refused' }));
  vi.stubGlobal('fetch', fetchMock);
  await expect(openThreadTerminal(thread, 'native-source')).rejects.toMatchObject({ name: 'PaneActionError', outcomeUncertain: false, errorCode: 'thread_not_found' });
  await expect(closeThreadPane(thread, 'native-pane', true)).rejects.toMatchObject({ name: 'PaneActionError', outcomeUncertain: true, errorCode: 'pane_outcome_unknown' });
  await expect(openThreadTerminal(thread, 'native-source')).rejects.toMatchObject({ outcomeUncertain: false, errorCode: 'pane_action_refused' });
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it('treats a lost response and malformed successful acknowledgements as uncertain', async () => {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response(200, {}));
  fetchMock.mockRejectedValueOnce(new TypeError('network lost')).mockImplementationOnce(async () => response(200, { closed: true, busy: 'false' }));
  vi.stubGlobal('fetch', fetchMock);
  await expect(openThreadTerminal(thread, 'native-source')).rejects.toBeInstanceOf(PaneActionError);
  await expect(openThreadTerminal(thread, 'native-source')).rejects.toMatchObject({ outcomeUncertain: true });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
