import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useQueryClient } from '@tanstack/react-query';
import { RuntimeProvider, useRuntime } from '../../src/client/provider';
import { handleRouteClick, RouteNavigationProvider, useRouteNavigation } from '../../src/client/app-navigation';
import { buildPendingThreadUrl } from '../../src/client/navigation';
import { ThreadTickets, waitForTicketDelay } from '../../src/client/create-tickets';
import { NewThreadView } from '../../src/components/NewThreadView';
import { PendingOperation, PendingResourceOperation } from '../../src/components/PendingOperation';
import { terminalStartupStorageKey } from '../../src/client/terminal-presets';
import type { Bootstrap, LaunchInput } from '../../src/shared/runtime';
import { recoveryStoragePrefix, type NewThreadDraft } from '../../src/client/new-thread-draft';

vi.mock('../../src/client/terminal-manager', () => ({ BrowserTerminalManager: class { start() {} stop() {} } }));
vi.mock('bot-avatars', async (importOriginal) => ({ ...await importOriginal<typeof import('bot-avatars')>(), BotAvatar: () => null }));
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
const resourceOperationId = '33333333-3333-4333-8333-333333333333';
const worktreeOperationId = '44444444-4444-4444-8444-444444444444';
const worktreeResult = { threadId: 'thread-from-worktree' };
const worktreeResponse = (state: 'pending' | 'ready' | 'failed' | 'unknown') => new Response(JSON.stringify({
  operationId: worktreeOperationId, kind: 'worktree', state, step: state === 'ready' ? 'ready' : 'open',
  ...(state === 'ready' ? { result: worktreeResult } : {}), ...(state === 'failed' ? { error: 'unknown_worktree' } : {}), statusUrl: `/api/operations/${worktreeOperationId}`,
}), { status: 202, headers: { 'Content-Type': 'application/json' } });
const resourceResult = { workspaceId: 'workspace-resource', tabId: 'workspace-resource:tab', paneId: 'workspace-resource:pane', terminalId: 'term_resource' };
const resourceResponse = (state: 'pending' | 'ready' | 'unknown') => new Response(JSON.stringify({
  operationId: resourceOperationId, kind: 'terminal', state, step: state === 'ready' ? 'ready' : 'workspace',
  ...(state === 'ready' ? { result: resourceResult } : {}), statusUrl: `/api/operations/${resourceOperationId}`,
}), { status: 202, headers: { 'Content-Type': 'application/json' } });
let currentTickets: ThreadTickets | undefined;
let currentQueryClient: ReturnType<typeof useQueryClient> | undefined;

function RouteHarness() {
  const { route, navigate } = useRouteNavigation();
  currentTickets = useRuntime().tickets;
  currentQueryClient = useQueryClient();
  return <div onClickCapture={(event) => handleRouteClick(event, navigate)}>
    <button type="button" onClick={() => navigate('/new?project=local%3Afirst')}>Navigate to composer</button>
    <button type="button" onClick={() => {
      const ticket = currentTickets!.createResource('terminal', { machineId: 'local', path: '~/' }, { session: 'default', startupPreset: 'resource-monitor' });
      navigate(buildPendingThreadUrl(ticket.key, window.location.href, 'resource'));
    }}>Start standalone terminal</button>
    <button type="button" onClick={() => {
      const ticket = currentTickets!.createResource('worktree', { machineId: 'local', projectId: 'local:first', path: '/first/worktrees/feature' });
      navigate(buildPendingThreadUrl(ticket.key, window.location.href, 'resource'));
      void currentTickets!.startResource(ticket.key);
    }}>Start worktree</button>
    {route.type === 'composer' && route.resourcePendingKey
      ? <PendingResourceOperation key={`${currentTickets?.resourceRecoveryScope}:${route.resourcePendingKey}`} ticketKey={route.resourcePendingKey} />
      : route.type === 'composer' && route.pendingKey
        ? <PendingOperation key={`${currentTickets?.recoveryScope}:${route.pendingKey}`} ticketKey={route.pendingKey} />
      : route.type === 'composer'
        ? <NewThreadView projects={projects} machines={machines} selectedProjectId={route.projectId} onOpenSidebar={() => {}} onNavigate={navigate} />
        : <main><h1>{route.type}</h1></main>}
  </div>;
}

function renderRoute(initialUrl = '/new?project=local%3Afirst') {
  window.history.replaceState(null, '', initialUrl);
  return render(<RuntimeProvider bootstrap={bootstrap}><RouteNavigationProvider initialUrl={window.location.href}><RouteHarness /></RouteNavigationProvider></RuntimeProvider>);
}

function denySessionStorageWrites() {
  const storage = window.sessionStorage;
  const setItem = vi.fn((_key: string, _value: string) => { throw new Error('storage denied'); });
  vi.stubGlobal('sessionStorage', {
    get length() { return storage.length; },
    clear: () => storage.clear(),
    getItem: (key: string) => storage.getItem(key),
    key: (index: number) => storage.key(index),
    removeItem: (key: string) => storage.removeItem(key),
    setItem,
  } satisfies Storage);
  return setItem;
}

afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers();
  Reflect.deleteProperty(document, 'visibilityState');
  localStorage.clear(); sessionStorage.clear(); window.history.replaceState(null, '', '/'); currentTickets = undefined; currentQueryClient = undefined;
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
  expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true');
  expect(document.querySelector('.loading-orb-visual')).not.toBeNull();
  expect(document.querySelector('.loading-step')?.textContent).toBe('Checking the machine…');
  await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
  expect(new URL(window.location.href).searchParams.get('pending')).toMatch(/^[0-9a-f-]{36}$/);
  expect(new URL(window.location.href).searchParams.get('project')).toBe('local:first');

  await act(async () => { resolvePost(response('unknown')); await currentTickets!.start(new URL(window.location.href).searchParams.get('pending')!); });
  expect(screen.getByRole('heading', { name: 'Launch outcome uncertain' })).toBeDefined();
});

it('warns visibly when storage is denied while retaining the in-memory ticket and draft', async () => {
  const deniedSetItem = denySessionStorageWrites();
  const fetcher = vi.fn((_request: RequestInfo | URL, _init?: RequestInit) => new Promise<Response>(() => {}));
  vi.stubGlobal('fetch', fetcher);
  renderRoute();
  const user = userEvent.setup();
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Harness: Claude Code' })).toBeDefined());
  await user.type(screen.getByRole('textbox', { name: 'Thread prompt' }), 'Keep this draft');
  await user.click(screen.getByRole('button', { name: 'Create thread' }));

  const key = new URL(window.location.href).searchParams.get('pending')!;
  expect(deniedSetItem).toHaveBeenCalled();
  expect(currentTickets?.get(key)?.reloadRecoveryUnavailable).toBe(true);
  expect(await screen.findByText(/held in memory only; reloading will lose recovery/i)).toBeDefined();
  expect(document.querySelector('.loading-step')?.textContent).toBe('Checking the machine…');
  expect(currentTickets?.getDraft(key)?.prompt).toBe('Keep this draft');
  expect(fetcher).toHaveBeenCalledOnce();
  await user.click(screen.getByRole('button', { name: 'Navigate to composer' }));
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

it('preserves memory-only thread recovery when only the resource scope changes', () => {
  denySessionStorageWrites();
  const initialBootstrap = { ...bootstrap, resourceRecoveryScope: 'resource-session-one' };
  const tree = (value: Bootstrap) => <RuntimeProvider bootstrap={value}><RouteNavigationProvider initialUrl="/new"><RouteHarness /></RouteNavigationProvider></RuntimeProvider>;
  const view = render(tree(initialBootstrap));
  const previous = currentTickets!;
  const thread = previous.create(input, draft);
  const resource = previous.createResource('terminal', { machineId: 'local', path: '/project' });
  const worktree = previous.createResource('worktree', { machineId: 'local', projectId: 'local:first', path: '/first/worktrees/feature' });
  expect(thread.reloadRecoveryUnavailable).toBe(true);

  view.rerender(tree({ ...bootstrap, resourceRecoveryScope: 'resource-session-two' }));

  expect(currentTickets).toBe(previous);
  expect(currentTickets?.get(thread.key)?.key).toBe(thread.key);
  expect(currentTickets?.getDraft(thread.key)?.prompt).toBe(draft.prompt);
  expect(currentTickets?.getResource(resource.key)).toBeUndefined();
  expect(currentTickets?.getResource(worktree.key)).toBeUndefined();
});

it('recovers an in-memory draft and attachments through Edit draft when storage is denied', async () => {
  denySessionStorageWrites();
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

  expect(await screen.findByRole('heading', { name: 'Launch outcome uncertain' })).toBeDefined();
  expect(screen.getByText('Inspect this source')).toBeDefined();
  expect(screen.getByText('source.png')).toBeDefined();
  expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
  expect(screen.getByRole('link', { name: 'Edit draft' })).toBeDefined();
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
  await user.click(screen.getByRole('button', { name: 'Navigate to composer' }));
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

it('resumes a persisted resource ticket through status-only polling after reload', async () => {
  vi.useFakeTimers();
  const key = '66666666-6666-4666-8666-666666666666';
  const stored = {
    kind: 'terminal', endpoint: '/api/terminals', key, normalizedPayload: { machineId: 'local', path: '~/' }, createdAt: Date.now(),
    operationId: resourceOperationId, statusUrl: `/api/operations/${resourceOperationId}`, state: 'pending', step: 'create',
    transport: 'accepted', reloadRecoveryUnavailable: false, session: 'default', startupPreset: 'resource-monitor',
  };
  sessionStorage.setItem(`${recoveryStoragePrefix(bootstrap.recoveryScope)}resource-ticket:${key}`, JSON.stringify(stored));
  const fetcher = vi.fn(async (_request: RequestInfo | URL, _init?: RequestInit) => resourceResponse('ready'));
  vi.stubGlobal('fetch', fetcher);
  renderRoute(`/new?resourcePending=${key}`);
  await act(async () => { await vi.runAllTimersAsync(); });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0]?.[0]).toBe(`/api/operations/${resourceOperationId}`);
  expect(fetcher.mock.calls[0]?.[1]).toBeUndefined();
  expect(window.location.pathname).toBe(`/sessions/default/tabs/${encodeURIComponent(resourceResult.tabId)}`);
  expect(sessionStorage.getItem(terminalStartupStorageKey('local', resourceResult.tabId))).toBe('resource-monitor');
});

it('opens a terminal only after its create result is ready, then consumes the startup preset once', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(async (_request: RequestInfo | URL, init?: RequestInit) => init?.method === 'POST' ? resourceResponse('pending') : resourceResponse('ready'));
  vi.stubGlobal('fetch', fetcher);
  renderRoute('/new');
  act(() => fireEvent.click(screen.getByRole('button', { name: 'Start standalone terminal' })));
  const key = new URL(window.location.href).searchParams.get('resourcePending')!;
  expect(screen.getByRole('main', { name: 'Pending terminal' })).toBeDefined();
  expect(screen.getByRole('heading', { name: 'Creating terminal' })).toBeDefined();
  expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true');
  expect(document.querySelector('.loading-orb-visual')).not.toBeNull();
  expect(sessionStorage.getItem(terminalStartupStorageKey('local', resourceResult.tabId))).toBeNull();
  await act(async () => { await vi.runAllTimersAsync(); });
  expect(window.location.pathname).toBe(`/sessions/default/tabs/${encodeURIComponent(resourceResult.tabId)}`);
  expect(new URL(window.location.href).searchParams.get('startup')).toBe('resource-monitor');
  expect(sessionStorage.getItem(terminalStartupStorageKey('local', resourceResult.tabId))).toBe('resource-monitor');
  expect(currentTickets?.getResource(key)?.startupPreset).toBeUndefined();
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('keeps an uncertain terminal create pending without opening a tab or replaying it', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(async () => resourceResponse('unknown'));
  vi.stubGlobal('fetch', fetcher);
  renderRoute('/new');
  act(() => fireEvent.click(screen.getByRole('button', { name: 'Start standalone terminal' })));
  await act(async () => { await vi.runAllTimersAsync(); });
  expect(screen.getByRole('heading', { name: 'Create outcome uncertain' })).toBeDefined();
  expect(screen.getByRole('alert').textContent).toContain('will not replay');
  expect(window.location.pathname).toBe('/new');
  expect(fetcher).toHaveBeenCalledOnce();
  expect(sessionStorage.getItem(terminalStartupStorageKey('local', resourceResult.tabId))).toBeNull();
});

it('warns when resource-ticket storage is denied while retaining in-memory recovery', async () => {
  vi.useFakeTimers();
  const deniedSetItem = denySessionStorageWrites();
  const fetcher = vi.fn(async () => resourceResponse('unknown'));
  vi.stubGlobal('fetch', fetcher);
  renderRoute('/new');
  act(() => fireEvent.click(screen.getByRole('button', { name: 'Start standalone terminal' })));
  const key = new URL(window.location.href).searchParams.get('resourcePending')!;
  await act(async () => { await vi.runAllTimersAsync(); });
  expect(deniedSetItem).toHaveBeenCalled();
  expect(currentTickets?.getResource(key)?.reloadRecoveryUnavailable).toBe(true);
  expect(screen.getByText(/This ticket is held in memory only; reloading will lose recovery/i)).toBeDefined();
  expect(fetcher).toHaveBeenCalledOnce();
});

it('retries only an interrupted create POST with the same key and exact normalized payload', async () => {
  vi.useFakeTimers();
  let postCount = 0;
  const fetcher = vi.fn((_request: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method !== 'POST') return Promise.resolve(resourceResponse('ready'));
    if (postCount++ === 0) return Promise.reject(new Error('connection lost'));
    return Promise.resolve(resourceResponse('unknown'));
  });
  vi.stubGlobal('fetch', fetcher);
  renderRoute('/new');
  act(() => fireEvent.click(screen.getByRole('button', { name: 'Start standalone terminal' })));
  await act(async () => { await vi.runAllTimersAsync(); });
  const posts = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(posts).toHaveLength(2);
  expect(posts[0]?.[1]?.headers).toEqual(posts[1]?.[1]?.headers);
  expect(JSON.parse(posts[0]?.[1]?.body as string)).toEqual(JSON.parse(posts[1]?.[1]?.body as string));
  expect((posts[0]?.[1]?.headers as Record<string, string>)['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
  expect(window.location.pathname).toBe('/new');
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('does not redirect from the composer when the user leaves a pending terminal create', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(async (_request: RequestInfo | URL, init?: RequestInit) => init?.method === 'POST' ? resourceResponse('pending') : resourceResponse('ready'));
  vi.stubGlobal('fetch', fetcher);
  renderRoute('/new');
  act(() => fireEvent.click(screen.getByRole('button', { name: 'Start standalone terminal' })));
  act(() => fireEvent.click(screen.getByRole('button', { name: 'Navigate to composer' })));
  await act(async () => { await vi.runAllTimersAsync(); });
  expect(window.location.pathname).toBe('/new');
  expect(new URL(window.location.href).searchParams.get('resourcePending')).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('recovers a persisted worktree ticket through status-only polling and opens its confirmed thread', async () => {
  vi.useFakeTimers();
  const key = '77777777-7777-4777-8777-777777777777';
  const stored = {
    kind: 'worktree', endpoint: '/api/worktrees/open', key, createdAt: Date.now(), normalizedPayload: { machineId: 'local', projectId: 'local:first', path: '/first/worktrees/feature' },
    operationId: worktreeOperationId, statusUrl: `/api/operations/${worktreeOperationId}`, state: 'pending', step: 'open',
    transport: 'accepted', reloadRecoveryUnavailable: false,
  };
  sessionStorage.setItem(`${recoveryStoragePrefix(bootstrap.recoveryScope)}resource-ticket:${key}`, JSON.stringify(stored));
  const fetcher = vi.fn(async (_request: RequestInfo | URL, _init?: RequestInit) => worktreeResponse('ready'));
  vi.stubGlobal('fetch', fetcher);
  renderRoute(`/new?resourcePending=${key}`);
  const queryKey = ['worktrees', 'pending-ui-scope', 'local', 'local:first'] as const;
  currentQueryClient!.setQueryDefaults(queryKey, { gcTime: Infinity });
  currentQueryClient!.setQueryData(queryKey, [{ path: '/first/worktrees/feature' }]);

  await act(async () => { await vi.runAllTimersAsync(); });

  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0]?.[0]).toBe(`/api/operations/${worktreeOperationId}`);
  expect(fetcher.mock.calls[0]?.[1]).toBeUndefined();
  expect(window.location.pathname).toBe(`/threads/${worktreeResult.threadId}`);
  expect(currentQueryClient!.getQueryState(queryKey)?.isInvalidated).toBe(true);
});

it.each([
  { label: 'missing', result: undefined },
  { label: 'wrong-shaped', result: 'wrong' },
  { label: 'extra-field', result: { threadId: 'guessed-thread', extra: true } },
])('never navigates or invalidates worktrees for a $label ready result', async ({ result }) => {
  vi.useFakeTimers();
  const malformed = new Response(JSON.stringify({
    operationId: worktreeOperationId, kind: 'worktree', state: 'ready', step: 'ready',
    ...(result !== undefined ? { result } : {}), statusUrl: `/api/operations/${worktreeOperationId}`,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const fetcher = vi.fn(async (_request: RequestInfo | URL, init?: RequestInit) => init?.method === 'POST' ? worktreeResponse('pending') : malformed);
  vi.stubGlobal('fetch', fetcher);
  renderRoute('/new');
  const queryKey = ['worktrees', 'pending-ui-scope', 'local', 'local:first'] as const;
  currentQueryClient!.setQueryDefaults(queryKey, { gcTime: Infinity });
  currentQueryClient!.setQueryData(queryKey, [{ path: '/first/worktrees/feature' }]);
  act(() => fireEvent.click(screen.getByRole('button', { name: 'Start worktree' })));

  await act(async () => { await vi.runAllTimersAsync(); });

  expect(screen.getByRole('heading', { name: 'Worktree outcome uncertain' })).toBeDefined();
  expect(screen.queryByRole('link', { name: 'Open thread' })).toBeNull();
  expect(window.location.pathname).toBe('/new');
  expect(currentQueryClient!.getQueryState(queryKey)?.isInvalidated).toBe(false);
});

it('uses a new idempotency key only after an explicit retry of a failed worktree open', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(async (_request: RequestInfo | URL, _init?: RequestInit) => worktreeResponse('failed'));
  vi.stubGlobal('fetch', fetcher);
  renderRoute('/new');
  act(() => fireEvent.click(screen.getByRole('button', { name: 'Start worktree' })));
  await act(async () => { await vi.runAllTimersAsync(); });
  expect(screen.getByRole('heading', { name: 'Could not open worktree' })).toBeDefined();
  const firstKey = (fetcher.mock.calls[0]?.[1]?.headers as Record<string, string>)['Idempotency-Key'];

  act(() => fireEvent.click(screen.getByRole('button', { name: 'Try again with a new request' })));
  await act(async () => { await vi.runAllTimersAsync(); });
  expect(screen.getByRole('heading', { name: 'Could not open worktree' })).toBeDefined();
  const posts = fetcher.mock.calls.map(([, init]) => (init?.headers as Record<string, string>)['Idempotency-Key']);
  expect(posts).toHaveLength(2);
  expect(firstKey).not.toBe(posts[1]);
});

it('does not navigate after a worktree ticket completes when the user leaves its pending view', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(async (_request: RequestInfo | URL, init?: RequestInit) => init?.method === 'POST' ? worktreeResponse('pending') : worktreeResponse('ready'));
  vi.stubGlobal('fetch', fetcher);
  renderRoute('/new');
  act(() => fireEvent.click(screen.getByRole('button', { name: 'Start worktree' })));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(fetcher).toHaveBeenCalledOnce();
  act(() => fireEvent.click(screen.getByRole('button', { name: 'Navigate to composer' })));

  await act(async () => { await vi.runAllTimersAsync(); });

  expect(window.location.pathname).toBe('/new');
  expect(new URL(window.location.href).searchParams.get('resourcePending')).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('warns when worktree recovery storage is denied while retaining the in-memory ticket', async () => {
  vi.useFakeTimers();
  const deniedSetItem = denySessionStorageWrites();
  const fetcher = vi.fn(async () => worktreeResponse('unknown'));
  vi.stubGlobal('fetch', fetcher);
  renderRoute('/new');
  act(() => fireEvent.click(screen.getByRole('button', { name: 'Start worktree' })));
  const key = new URL(window.location.href).searchParams.get('resourcePending')!;

  await act(async () => { await vi.runAllTimersAsync(); });

  expect(deniedSetItem).toHaveBeenCalled();
  expect(currentTickets?.getResource(key)?.reloadRecoveryUnavailable).toBe(true);
  expect(screen.getByText(/held in memory only; reloading will lose recovery/i)).toBeDefined();
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
