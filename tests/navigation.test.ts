import { expect, it, vi } from 'vitest';
import {
  buildPendingThreadUrl,
  buildRouteUrl,
  createRouteHistoryController,
  isPlainLinkEligible,
  parseRoute,
  type Route,
  type RouteHistoryDependencies,
  type RouteLink,
  type SupportedRoute,
} from '../src/client/navigation';

function supported(route: Route): SupportedRoute {
  if (route.type === 'unsupported') throw new Error(`Expected a supported route, got ${route.pathname}`);
  return route;
}

function link(href: string, attributes: string[] = [], target = '', download = ''): RouteLink {
  return { href, target, download, hasAttribute: (name) => attributes.includes(name) };
}

it('parses and builds composer routes with an opaque pending key and unrelated URL state', () => {
  const route = supported(parseRoute('/new?project=proj%2Fone&pending=ticket%252Fone&sidebar=collapsed&key=legacy&keep=a+b#compose'));
  if (route.type !== 'composer') throw new Error('Expected a composer route');
  expect(route).toMatchObject({
    type: 'composer',
    projectId: 'proj/one',
    pendingKey: 'ticket%2Fone',
    sidebarCollapsed: true,
    hash: '#compose',
  });
  expect(buildRouteUrl(route)).toBe('/new?project=proj%2Fone&pending=ticket%252Fone&sidebar=collapsed&key=legacy&keep=a+b#compose');
  expect(buildRouteUrl({ ...route, projectId: undefined, pendingKey: undefined, sidebarCollapsed: false }))
    .toBe('/new?key=legacy&keep=a+b#compose');

  const legacyKeyRoute = supported(parseRoute('/new?key=not-pending'));
  expect(legacyKeyRoute).toMatchObject({ type: 'composer', pendingKey: undefined });
  expect(buildRouteUrl(legacyKeyRoute)).toBe('/new?key=not-pending');
});

it('keeps resource-pending routes separate from thread-pending routes', () => {
  const route = supported(parseRoute('/new?pending=thread%252Fone&resourcePending=resource%252Fone&keep=1#composer'));
  expect(route).toMatchObject({ type: 'composer', pendingKey: 'thread%2Fone', resourcePendingKey: 'resource%2Fone' });
  expect(buildRouteUrl(route)).toBe('/new?pending=thread%252Fone&resourcePending=resource%252Fone&keep=1#composer');
  expect(buildPendingThreadUrl('resource-two', '/new?pending=thread-one&keep=1#composer', 'resource'))
    .toBe('/new?keep=1&resourcePending=resource-two#composer');
  expect(buildPendingThreadUrl('thread-two', '/new?resourcePending=resource-one&keep=1#composer'))
    .toBe('/new?keep=1&pending=thread-two#composer');
});

it('parses and builds thread routes without double-decoding opaque IDs', () => {
  const route = supported(parseRoute('/threads/agent%252Fone?sidebar=collapsed&keep=1#pane'));
  expect(route).toMatchObject({ type: 'thread', threadId: 'agent%2Fone', sidebarCollapsed: true });
  expect(buildRouteUrl(route)).toBe('/threads/agent%252Fone?sidebar=collapsed&keep=1#pane');
});

it('parses and builds terminal routes without interpreting pending query state', () => {
  const route = supported(parseRoute('/sessions/session%252Fone/tabs/tab%2Fone?machine=machine%252Fid&startup=resource-monitor&pending=ticket%2Fkey&key=legacy&sidebar=collapsed&keep=x#terminal%20pane'));
  expect(route).toMatchObject({
    type: 'terminal',
    machineId: 'machine%2Fid',
    session: 'session%2Fone',
    tabId: 'tab/one',
    startupPreset: 'resource-monitor',
    sidebarCollapsed: true,
  });
  expect(route).not.toHaveProperty('pendingKey');
  expect(buildRouteUrl(route)).toBe('/sessions/session%252Fone/tabs/tab%2Fone?machine=machine%252Fid&startup=resource-monitor&pending=ticket%2Fkey&key=legacy&sidebar=collapsed&keep=x#terminal%20pane');
  if (route.type !== 'terminal') throw new Error('Expected a terminal route');
  expect(buildRouteUrl({ ...route, startupPreset: undefined })).toBe('/sessions/session%252Fone/tabs/tab%2Fone?machine=machine%252Fid&pending=ticket%2Fkey&key=legacy&sidebar=collapsed&keep=x#terminal%20pane');
});

it('parses and builds settings routes', () => {
  const route = supported(parseRoute('/settings?sidebar=collapsed#settings'));
  expect(route).toMatchObject({ type: 'settings', sidebarCollapsed: true, hash: '#settings' });
  expect(buildRouteUrl(route)).toBe('/settings?sidebar=collapsed#settings');
});

it('accepts only allowlisted terminal startup presets and preserves other query values', () => {
  const route = supported(parseRoute('/sessions/s/tabs/t?machine=m&startup=unknown&other=value'));
  expect(route).toMatchObject({ type: 'terminal', startupPreset: undefined });
  expect(buildRouteUrl(route)).toBe('/sessions/s/tabs/t?machine=m&startup=unknown&other=value');
});

it('returns unsupported results for root redirects, unknown routes, missing terminal identity, and malformed escapes', () => {
  expect(parseRoute('/').type).toBe('unsupported');
  expect(parseRoute('/not-a-page')).toMatchObject({ type: 'unsupported', pathname: '/not-a-page' });
  expect(parseRoute('/sessions/s/tabs/t')).toMatchObject({ type: 'unsupported', reason: 'malformed-path' });
  expect(parseRoute('/threads/%E0%A4%A')).toMatchObject({ type: 'unsupported', reason: 'malformed-path' });
  expect(parseRoute('http://[invalid')).toMatchObject({ type: 'unsupported', reason: 'invalid-url' });
});

it('updates snapshots on push, replace, back, and forward while preserving history state and making no fetches', () => {
  let href = 'https://webr.test/new?project=first';
  const historyState = { unrelated: 'preserved' };
  let state: unknown = historyState;
  const entries = [{ href, state }];
  let index = 0;
  const popstateListeners = new Set<() => void>();
  const pushCalls: Array<{ state: unknown; url: string | URL | null | undefined }> = [];
  const replaceCalls: Array<{ state: unknown; url: string | URL | null | undefined }> = [];
  const history = {
    get state() { return state; },
    pushState(nextState: unknown, _unused: string, url?: string | URL | null) {
      pushCalls.push({ state: nextState, url });
      const nextHref = url == null ? href : new URL(url, href).href;
      entries.splice(index + 1);
      entries.push({ href: nextHref, state: nextState });
      index += 1;
      href = nextHref;
      state = nextState;
    },
    replaceState(nextState: unknown, _unused: string, url?: string | URL | null) {
      replaceCalls.push({ state: nextState, url });
      const nextHref = url == null ? href : new URL(url, href).href;
      entries[index] = { href: nextHref, state: nextState };
      href = nextHref;
      state = nextState;
    },
  };
  const dependencies: RouteHistoryDependencies = {
    location: { get href() { return href; } },
    history,
    addEventListener(_type, listener) { popstateListeners.add(listener); },
    removeEventListener(_type, listener) { popstateListeners.delete(listener); },
  };
  const go = (delta: number) => {
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= entries.length) return;
    const entry = entries[nextIndex];
    if (!entry) return;
    index = nextIndex;
    href = entry.href;
    state = entry.state;
    for (const listener of popstateListeners) listener();
  };
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);

  try {
    const controller = createRouteHistoryController(dependencies);
    expect(controller.getSnapshot()).toMatchObject({ type: 'composer', projectId: 'first' });
    const snapshots: string[] = [];
    const unsubscribe = controller.subscribe(() => snapshots.push(controller.getSnapshot().type));
    expect(popstateListeners.size).toBe(1);

    controller.navigate(supported(parseRoute('/settings?sidebar=collapsed#settings')), { replace: true });
    expect(replaceCalls).toHaveLength(1);
    expect(replaceCalls.at(0)?.state).toBe(historyState);
    expect(pushCalls).toHaveLength(0);
    expect(controller.getSnapshot()).toMatchObject({ type: 'settings', sidebarCollapsed: true });

    controller.navigate(supported(parseRoute('/threads/next')));
    controller.navigate(supported(parseRoute('/sessions/s/tabs/t?machine=m')));
    expect(pushCalls).toHaveLength(2);
    expect(pushCalls.every((call) => call.state === historyState)).toBe(true);

    go(-1);
    expect(controller.getSnapshot()).toMatchObject({ type: 'thread', threadId: 'next' });
    go(-1);
    expect(controller.getSnapshot()).toMatchObject({ type: 'settings' });
    go(1);
    expect(controller.getSnapshot()).toMatchObject({ type: 'thread', threadId: 'next' });
    go(1);
    expect(controller.getSnapshot()).toMatchObject({ type: 'terminal', machineId: 'm' });
    expect(snapshots).toHaveLength(7);
    expect(fetchMock).not.toHaveBeenCalled();

    unsubscribe();
    expect(popstateListeners.size).toBe(0);
    controller.dispose();
  } finally {
    vi.unstubAllGlobals();
  }
});

it('removes its popstate subscription when disposed', () => {
  let href = 'https://webr.test/new';
  const listeners = new Set<() => void>();
  const dependencies: RouteHistoryDependencies = {
    location: { get href() { return href; } },
    history: {
      state: null,
      pushState() {},
      replaceState() {},
    },
    addEventListener(_type, listener) { listeners.add(listener); },
    removeEventListener(_type, listener) { listeners.delete(listener); },
  };
  const controller = createRouteHistoryController(dependencies);
  let notifications = 0;
  controller.subscribe(() => { notifications += 1; });
  expect(listeners.size).toBe(1);

  controller.dispose();
  href = 'https://webr.test/settings';
  for (const listener of listeners) listener();
  expect(listeners.size).toBe(0);
  expect(notifications).toBe(0);
  expect(controller.getSnapshot().type).toBe('composer');
  controller.dispose();
});

it('allows only unmodified left clicks on plain same-origin supported HTTP links', () => {
  const currentHref = 'https://webr.test/new';
  const plainClick = { button: 0, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };
  expect(isPlainLinkEligible(plainClick, link('/threads/id'), currentHref)).toBe(true);
  expect(isPlainLinkEligible({ ...plainClick, button: 1 }, link('/threads/id'), currentHref)).toBe(false);
  for (const modifier of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey'] as const) {
    expect(isPlainLinkEligible({ ...plainClick, [modifier]: true }, link('/threads/id'), currentHref)).toBe(false);
  }
  expect(isPlainLinkEligible(plainClick, link('https://other.test/new'), currentHref)).toBe(false);
  expect(isPlainLinkEligible(plainClick, link('mailto:user@example.test'), currentHref)).toBe(false);
  expect(isPlainLinkEligible(plainClick, link('/unknown'), currentHref)).toBe(false);
  expect(isPlainLinkEligible(plainClick, link('/', ['data-document-navigation']), currentHref)).toBe(false);
  expect(isPlainLinkEligible(plainClick, link('/new', ['download']), currentHref)).toBe(false);
  expect(isPlainLinkEligible(plainClick, link('/new', ['target']), currentHref)).toBe(false);
  expect(isPlainLinkEligible(plainClick, link('/new', [], '_blank'), currentHref)).toBe(false);
  expect(isPlainLinkEligible(plainClick, link('/new', [], '', 'download.txt'), currentHref)).toBe(false);
});

it('imports and parses without a window global', async () => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  try {
    if (windowDescriptor) Reflect.deleteProperty(globalThis, 'window');
    vi.resetModules();
    const navigation = await import('../src/client/navigation');
    expect(navigation.parseRoute('/new').type).toBe('composer');
  } finally {
    if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor);
    vi.resetModules();
  }
});
