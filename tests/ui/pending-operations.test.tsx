import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RuntimeProvider, useRuntime } from '../../src/client/provider';
import { handleRouteClick, RouteNavigationProvider, useRouteNavigation } from '../../src/client/app-navigation';
import { buildPendingThreadUrl } from '../../src/client/navigation';
import { ThreadTickets, waitForTicketDelay } from '../../src/client/create-tickets';
import { NewThreadView } from '../../src/components/NewThreadView';
import { PendingOperation } from '../../src/components/PendingOperation';
import type { Bootstrap, LaunchInput } from '../../src/shared/runtime';
import type { NewThreadDraft } from '../../src/client/new-thread-draft';

vi.mock('../../src/client/terminal-manager', () => ({ BrowserTerminalManager: class { start() {} stop() {} } }));
vi.mock('../../src/client/catalog', () => ({ useMachineCatalog: () => ({
  data: { isGitRepo: true, harnesses: [{ id: 'claude', name: 'Claude Code', models: ['Default'], launchEnabled: true }] },
  isError: false, isLoading: false, isRefetchError: false,
}) }));

const bootstrap: Bootstrap = { projections: [], machines: [], projects: [], threads: [], recoveryScope: 'pending-ui-scope' };
const projects = [{ id: 'local:first', name: 'First', path: '/first', color: '#555', initial: 'F', metadataVersion: 0 }];
const machines = [{ id: 'local', name: 'Local', connected: true, writable: true, session: 'default', projectPaths: { 'local:first': '/first' }, harnesses: [] }];
const input: LaunchInput = { machineId: 'local', projectId: 'local:first', prompt: 'Inspect this source /uploads/source.png', agent: 'claude', model: 'Default', worktree: true };
const draft: NewThreadDraft = {
  prompt: 'Inspect this source', projectId: 'local:first', machineId: 'local', harness: 'claude', worktree: true,
  images: [{ id: 'image-1', name: 'source.png', preview: 'data:image/png;base64,AA==', path: '/uploads/source.png' }],
};
const operationId = '22222222-2222-4222-8222-222222222222';
const response = (state: 'pending' | 'ready' | 'failed' | 'unknown') => new Response(JSON.stringify({
  operationId, kind: 'thread', state, step: state === 'ready' ? 'ready' : state === 'failed' ? 'checkout' : 'validate',
  result: { threadId: 'thread-real-id' }, statusUrl: `/api/operations/${operationId}`,
}), { status: 202, headers: { 'Content-Type': 'application/json' } });
let currentTickets: ThreadTickets | undefined;

function RouteHarness() {
  const { route, navigate } = useRouteNavigation();
  currentTickets = useRuntime().tickets;
  return <div onClickCapture={(event) => handleRouteClick(event, navigate)}>
    <button type="button" onClick={() => navigate('/new?project=local%3Afirst')}>Navigate to composer</button>
    {route.type === 'composer' && route.pendingKey
      ? <PendingOperation key={route.pendingKey} ticketKey={route.pendingKey} />
      : route.type === 'composer'
        ? <NewThreadView projects={projects} machines={machines} selectedProjectId={route.projectId} onOpenSidebar={() => {}} onNavigate={navigate} />
        : <main><h1>{route.type}</h1></main>}
  </div>;
}

function renderRoute(initialUrl = '/new?project=local%3Afirst') {
  window.history.replaceState(null, '', initialUrl);
  return render(<RuntimeProvider bootstrap={bootstrap}><RouteNavigationProvider initialUrl={window.location.href}><RouteHarness /></RouteNavigationProvider></RuntimeProvider>);
}

afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers();
  Reflect.deleteProperty(document, 'visibilityState');
  localStorage.clear(); sessionStorage.clear(); window.history.replaceState(null, '', '/'); currentTickets = undefined;
});

it('leaves the composer for a local pending view before the acceptance response resolves', async () => {
  let resolvePost!: (response: Response) => void;
  const fetcher = vi.fn((request: RequestInfo | URL, init?: RequestInit) => String(request) === '/api/threads' && init?.method === 'POST'
    ? new Promise<Response>((resolve) => { resolvePost = resolve; }) : Promise.resolve(response('unknown')));
  vi.stubGlobal('fetch', fetcher);
  renderRoute();
  const user = userEvent.setup();
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Harness: Claude Code' })).toBeDefined());
  await user.type(screen.getByRole('textbox', { name: 'Thread prompt' }), 'Inspect this source');
  await user.click(screen.getByRole('button', { name: 'Create thread' }));

  expect(screen.getByRole('main', { name: 'Pending thread' })).toBeDefined();
  expect(screen.getByRole('heading', { name: 'Starting your thread' })).toBeDefined();
  await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
  expect(new URL(window.location.href).searchParams.get('pending')).toMatch(/^[0-9a-f-]{36}$/);
  expect(new URL(window.location.href).searchParams.get('project')).toBe('local:first');

  await act(async () => { resolvePost(response('unknown')); await currentTickets!.start(new URL(window.location.href).searchParams.get('pending')!); });
  expect(screen.getByRole('heading', { name: 'Launch outcome uncertain' })).toBeDefined();
});

it('warns visibly when storage is denied while retaining the in-memory ticket and draft', async () => {
  vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => { throw new Error('storage denied'); });
  const fetcher = vi.fn((_request: RequestInfo | URL, _init?: RequestInit) => new Promise<Response>(() => {}));
  vi.stubGlobal('fetch', fetcher);
  renderRoute();
  const user = userEvent.setup();
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Harness: Claude Code' })).toBeDefined());
  await user.type(screen.getByRole('textbox', { name: 'Thread prompt' }), 'Keep this draft');
  await user.click(screen.getByRole('button', { name: 'Create thread' }));

  expect(await screen.findByText(/held in memory only; reloading will lose recovery/i)).toBeDefined();
  expect(screen.getByText('Keep this draft')).toBeDefined();
  expect(fetcher).toHaveBeenCalledOnce();
  await user.click(screen.getByRole('link', { name: 'Leave this pending view' }));
  expect((screen.getByRole('textbox', { name: 'Thread prompt' }) as HTMLTextAreaElement).value).toBe('');
  expect(fetcher).toHaveBeenCalledOnce();
});

it('does not restore a stale recovery URL from another recovery scope', async () => {
  const otherScope = new ThreadTickets('another-account-scope');
  const ticket = otherScope.create(input, draft);
  renderRoute(`/new?project=local%3Afirst&recover=${ticket.key}`);

  const prompt = screen.getByRole('textbox', { name: 'Thread prompt' }) as HTMLTextAreaElement;
  await waitFor(() => expect(prompt.value).toBe(''));
  expect(screen.queryByText(draft.prompt)).toBeNull();
  expect(sessionStorage.length).toBe(1);
});

it('recovers an in-memory draft and attachments through Edit draft when storage is denied', async () => {
  vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => { throw new Error('storage denied'); });
  vi.stubGlobal('fetch', vi.fn(async () => response('failed')));
  renderRoute();
  await waitFor(() => expect(currentTickets).toBeDefined());
  const ticket = currentTickets!.create(input, draft);

  act(() => {
    window.history.pushState(null, '', buildPendingThreadUrl(ticket.key, window.location.href));
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  expect(await screen.findByRole('heading', { name: 'The launch stopped' })).toBeDefined();
  const user = userEvent.setup();
  await user.click(screen.getByRole('link', { name: 'Edit draft' }));

  await waitFor(() => expect((screen.getByRole('textbox', { name: 'Thread prompt' }) as HTMLTextAreaElement).value).toBe(draft.prompt));
  expect(screen.getByAltText('source.png')).toBeDefined();
});

it('restores attachment references for an unknown ticket without offering a replay', async () => {
  const created = new ThreadTickets(bootstrap.recoveryScope, { sleep: async () => {} }).create(input, draft);
  const fetcher = vi.fn(async () => response('unknown'));
  vi.stubGlobal('fetch', fetcher);
  renderRoute(`/new?project=local%3Afirst&pending=${created.key}`);

  expect(screen.getByText('Inspect this source')).toBeDefined();
  expect(screen.getByText('source.png')).toBeDefined();
  expect(await screen.findByRole('heading', { name: 'Launch outcome uncertain' })).toBeDefined();
  expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
  expect(fetcher).toHaveBeenCalledOnce();
});

it('allocates a new key only after an explicit retry of a definitive failure', async () => {
  let attempts = 0;
  const fetcher = vi.fn(async (_request: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') return response(++attempts === 1 ? 'failed' : 'unknown');
    return response('unknown');
  });
  vi.stubGlobal('fetch', fetcher);
  renderRoute();
  const user = userEvent.setup();
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Harness: Claude Code' })).toBeDefined());
  await user.type(screen.getByRole('textbox', { name: 'Thread prompt' }), 'Retry only on request');
  await user.click(screen.getByRole('button', { name: 'Create thread' }));
  expect(await screen.findByRole('heading', { name: 'The launch stopped' })).toBeDefined();
  const firstKey = new URL(window.location.href).searchParams.get('pending');
  await user.click(screen.getByRole('button', { name: 'Try again with a new attempt' }));
  expect(await screen.findByRole('heading', { name: 'Launch outcome uncertain' })).toBeDefined();
  const secondKey = new URL(window.location.href).searchParams.get('pending');
  const posted = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(firstKey).not.toBe(secondKey);
  expect(posted).toHaveLength(2);
  expect(posted[0]?.[1]?.headers).toMatchObject({ 'Idempotency-Key': firstKey });
  expect(posted[1]?.[1]?.headers).toMatchObject({ 'Idempotency-Key': secondKey });
});

it('does not navigate away from the user after they leave a pending operation', async () => {
  let resolvePost!: (response: Response) => void;
  const fetcher = vi.fn((request: RequestInfo | URL, init?: RequestInit) => String(request) === '/api/threads' && init?.method === 'POST'
    ? new Promise<Response>((resolve) => { resolvePost = resolve; }) : Promise.resolve(response('pending')));
  vi.stubGlobal('fetch', fetcher);
  renderRoute();
  const user = userEvent.setup();
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Harness: Claude Code' })).toBeDefined());
  await user.type(screen.getByRole('textbox', { name: 'Thread prompt' }), 'Do not steal navigation');
  await user.click(screen.getByRole('button', { name: 'Create thread' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
  const key = new URL(window.location.href).searchParams.get('pending')!;
  await user.click(screen.getByRole('link', { name: 'Leave this pending view' }));
  expect(window.location.pathname).toBe('/new');

  await act(async () => { resolvePost(response('ready')); await currentTickets!.start(key); });
  expect(window.location.pathname).toBe('/new');
  expect(screen.getByRole('heading', { name: 'What do you want to build today?' })).toBeDefined();
});

it('opens the real thread once and preserves the definitive result when returning through history', async () => {
  let resolvePost!: (response: Response) => void;
  const fetcher = vi.fn((request: RequestInfo | URL, init?: RequestInit) => String(request) === '/api/threads' && init?.method === 'POST'
    ? new Promise<Response>((resolve) => { resolvePost = resolve; }) : Promise.resolve(response('pending')));
  vi.stubGlobal('fetch', fetcher);
  renderRoute();
  const user = userEvent.setup();
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Harness: Claude Code' })).toBeDefined());
  await user.type(screen.getByRole('textbox', { name: 'Thread prompt' }), 'Open only the confirmed resource');
  await user.click(screen.getByRole('button', { name: 'Create thread' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
  const pendingUrl = window.location.href;
  const key = new URL(pendingUrl).searchParams.get('pending')!;

  await act(async () => { resolvePost(response('ready')); await currentTickets!.start(key); });
  expect(window.location.pathname).toBe('/threads/thread-real-id');
  act(() => {
    window.history.replaceState(window.history.state, '', pendingUrl);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  expect(screen.getByRole('heading', { name: 'Your thread is ready' })).toBeDefined();
  expect(window.location.pathname).toBe('/new');
  expect(fetcher).toHaveBeenCalledOnce();
});

it('pauses the poll interval while the browser is offline', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('navigator', { onLine: true });
  let completed = false;
  const waiting = waitForTicketDelay(1000).then(() => { completed = true; });
  await vi.advanceTimersByTimeAsync(400);
  vi.stubGlobal('navigator', { onLine: false });
  window.dispatchEvent(new Event('offline'));
  await vi.advanceTimersByTimeAsync(5000);
  expect(completed).toBe(false);
  vi.stubGlobal('navigator', { onLine: true });
  window.dispatchEvent(new Event('online'));
  await vi.advanceTimersByTimeAsync(599);
  expect(completed).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  await waiting;
  expect(completed).toBe(true);
});

it('pauses the poll interval while the document is hidden', async () => {
  vi.useFakeTimers();
  const setVisibility = (value: DocumentVisibilityState) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value });
    document.dispatchEvent(new Event('visibilitychange'));
  };
  setVisibility('visible');
  let completed = false;
  const waiting = waitForTicketDelay(1000).then(() => { completed = true; });
  await vi.advanceTimersByTimeAsync(400);
  setVisibility('hidden');
  await vi.advanceTimersByTimeAsync(5000);
  expect(completed).toBe(false);
  setVisibility('visible');
  await vi.advanceTimersByTimeAsync(599);
  expect(completed).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  await waiting;
  expect(completed).toBe(true);
});
