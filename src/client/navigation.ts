import { terminalStartupCommands, type TerminalStartupPreset } from './terminal-presets';

type QueryEntry = readonly [string, string];

interface RouteUrlState {
  /** Decoded query entries retained so unrelated URL state survives round trips. */
  readonly query: readonly QueryEntry[];
  /** The URL fragment, including `#` when present. */
  readonly hash: string;
  readonly sidebarCollapsed: boolean;
}

export interface ComposerRoute extends RouteUrlState {
  readonly type: 'composer';
  readonly projectId?: string;
  readonly pendingKey?: string;
}

export interface ThreadRoute extends RouteUrlState {
  readonly type: 'thread';
  readonly threadId: string;
}

export interface TerminalRoute extends RouteUrlState {
  readonly type: 'terminal';
  readonly machineId: string;
  readonly session: string;
  readonly tabId: string;
  readonly startupPreset?: TerminalStartupPreset;
}

export interface SettingsRoute extends RouteUrlState {
  readonly type: 'settings';
}

export interface UnsupportedRoute extends RouteUrlState {
  readonly type: 'unsupported';
  readonly pathname: string;
  readonly reason: 'invalid-url' | 'malformed-path' | 'unsupported-path';
}

export type SupportedRoute = ComposerRoute | ThreadRoute | TerminalRoute | SettingsRoute;
export type Route = SupportedRoute | UnsupportedRoute;

const DEFAULT_BASE_URL = 'http://webr.local';

function routeUrlState(url: URL): RouteUrlState {
  return {
    query: Array.from(url.searchParams.entries(), ([key, value]) => [key, value] as const),
    hash: url.hash,
    sidebarCollapsed: url.searchParams.get('sidebar') === 'collapsed',
  };
}

function unsupportedRoute(
  pathname: string,
  reason: UnsupportedRoute['reason'],
  state: RouteUrlState = { query: [], hash: '', sidebarCollapsed: false },
): UnsupportedRoute {
  return { type: 'unsupported', pathname, reason, ...state };
}

function decodeSegment(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

function hasTerminalStartupPreset(value: string | null): value is TerminalStartupPreset {
  return value !== null && Object.hasOwn(terminalStartupCommands, value);
}

/** Parse an application URL without consulting browser globals. Path segments are decoded once. */
export function parseRoute(input: string | URL, baseUrl = DEFAULT_BASE_URL): Route {
  let url: URL;
  try {
    url = new URL(input instanceof URL ? input.href : input, baseUrl);
  } catch {
    return unsupportedRoute(typeof input === 'string' ? input : '', 'invalid-url');
  }

  const { pathname } = url;
  if (pathname === '/new') {
    const projectId = url.searchParams.get('project');
    const pendingKey = url.searchParams.get('pending');
    return {
      type: 'composer',
      ...routeUrlState(url),
      projectId: projectId ?? undefined,
      pendingKey: pendingKey ?? undefined,
    };
  }
  if (pathname === '/settings') return { type: 'settings', ...routeUrlState(url) };

  const segments = pathname.split('/');
  if (segments.length === 3 && segments[1] === 'threads') {
    const threadId = decodeSegment(segments[2] ?? '');
    if (!threadId) return unsupportedRoute(pathname, 'malformed-path', routeUrlState(url));
    return { type: 'thread', ...routeUrlState(url), threadId };
  }

  if (segments.length === 5 && segments[1] === 'sessions' && segments[3] === 'tabs') {
    const session = decodeSegment(segments[2] ?? '');
    const tabId = decodeSegment(segments[4] ?? '');
    const machineId = url.searchParams.get('machine');
    if (!session || !tabId || !machineId) return unsupportedRoute(pathname, 'malformed-path', routeUrlState(url));
    const startup = url.searchParams.get('startup');
    const startupPreset = hasTerminalStartupPreset(startup) ? startup : undefined;
    return {
      type: 'terminal',
      ...routeUrlState(url),
      machineId,
      session,
      tabId,
      startupPreset,
    };
  }

  // `/` is a server redirect whose destination depends on runtime state, not a composer page.
  return unsupportedRoute(pathname, 'unsupported-path', routeUrlState(url));
}

function paramsFromRoute(route: SupportedRoute): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of route.query) params.append(key, value);

  if (route.sidebarCollapsed) params.set('sidebar', 'collapsed');
  else params.delete('sidebar');

  if (route.type === 'composer') {
    if (route.projectId !== undefined) params.set('project', route.projectId);
    else params.delete('project');
    if (route.pendingKey !== undefined) params.set('pending', route.pendingKey);
    else params.delete('pending');
  }

  if (route.type === 'terminal') {
    params.set('machine', route.machineId);
    if (route.startupPreset !== undefined) params.set('startup', route.startupPreset);
    else if (hasTerminalStartupPreset(params.get('startup'))) params.delete('startup');
  }

  return params;
}

/** Build a same-origin path for a supported route, preserving its other query and hash state. */
export function buildRouteUrl(route: SupportedRoute): string {
  let pathname: string;
  switch (route.type) {
    case 'composer':
      pathname = '/new';
      break;
    case 'thread':
      pathname = `/threads/${encodeURIComponent(route.threadId)}`;
      break;
    case 'terminal':
      pathname = `/sessions/${encodeURIComponent(route.session)}/tabs/${encodeURIComponent(route.tabId)}`;
      break;
    case 'settings':
      pathname = '/settings';
      break;
  }

  const query = paramsFromRoute(route).toString();
  return `${pathname}${query ? `?${query}` : ''}${route.hash}`;
}

export interface RouteHistoryDependencies {
  readonly location: { readonly href: string };
  readonly history: {
    readonly state: unknown;
    pushState(data: unknown, unused: string, url?: string | URL | null): void;
    replaceState(data: unknown, unused: string, url?: string | URL | null): void;
  };
  addEventListener(type: 'popstate', listener: () => void): void;
  removeEventListener(type: 'popstate', listener: () => void): void;
}

export interface RouteHistoryController {
  subscribe(listener: () => void): () => void;
  getSnapshot(): Route;
  navigate(route: SupportedRoute, options?: { readonly replace?: boolean }): void;
  dispose(): void;
}

/** Create an explicitly owned history controller. No browser globals are read or listeners added here implicitly. */
export function createRouteHistoryController(dependencies: RouteHistoryDependencies): RouteHistoryController {
  let snapshot = parseRoute(dependencies.location.href);
  let disposed = false;
  let listening = false;
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) listener();
  };
  const onPopState = () => {
    if (disposed) return;
    snapshot = parseRoute(dependencies.location.href);
    notify();
  };
  const startListening = () => {
    if (!listening && !disposed) {
      dependencies.addEventListener('popstate', onPopState);
      listening = true;
    }
  };
  const stopListening = () => {
    if (listening) {
      dependencies.removeEventListener('popstate', onPopState);
      listening = false;
    }
  };

  return {
    subscribe(listener) {
      if (disposed) return () => {};
      listeners.add(listener);
      startListening();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stopListening();
      };
    },
    getSnapshot() {
      return snapshot;
    },
    navigate(route, options = {}) {
      if (disposed) return;
      const url = buildRouteUrl(route);
      const state = dependencies.history.state;
      if (options.replace) dependencies.history.replaceState(state, '', url);
      else dependencies.history.pushState(state, '', url);
      snapshot = parseRoute(url, dependencies.location.href);
      notify();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopListening();
      listeners.clear();
    },
  };
}

export interface RouteClickEvent {
  readonly button: number;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}

export interface RouteLink {
  readonly href: string;
  readonly target?: string | null;
  readonly download?: string | null;
  hasAttribute(name: string): boolean;
}

/** Whether a click is safe for client-side navigation instead of normal document navigation. */
export function isPlainLinkEligible(event: RouteClickEvent, link: RouteLink, currentHref: string): boolean {
  if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  if (link.hasAttribute('download') || link.hasAttribute('target') || link.hasAttribute('data-document-navigation')) return false;
  if (link.download != null && link.download !== '' || link.target != null && link.target !== '') return false;

  try {
    const currentUrl = new URL(currentHref);
    const destination = new URL(link.href, currentUrl);
    if ((destination.protocol !== 'http:' && destination.protocol !== 'https:') || destination.origin !== currentUrl.origin) return false;
    return parseRoute(destination).type !== 'unsupported';
  } catch {
    return false;
  }
}
