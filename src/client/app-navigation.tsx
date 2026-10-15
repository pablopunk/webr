import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import {
  createRouteHistoryController,
  parseRoute,
  isPlainLinkEligible,
  type Route,
  type RouteHistoryController,
  type SupportedRoute,
} from './navigation';

export type NavigateOptions = { readonly replace?: boolean };
type RouteNavigation = {
  readonly route: Route;
  navigate(target: string | SupportedRoute, options?: NavigateOptions): void;
};

export type AppNavigate = RouteNavigation['navigate'];

const RouteNavigationContext = createContext<RouteNavigation | null>(null);
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function RouteNavigationProvider({ initialUrl, children }: { initialUrl: string; children: ReactNode }) {
  const [route, setRoute] = useState(() => parseRoute(initialUrl));
  const controller = useRef<RouteHistoryController | null>(null);

  useIsomorphicLayoutEffect(() => {
    const history = createRouteHistoryController({
      location: window.location,
      history: window.history,
      addEventListener: (type, listener) => window.addEventListener(type, listener),
      removeEventListener: (type, listener) => window.removeEventListener(type, listener),
    });
    controller.current = history;
    const unsubscribe = history.subscribe(() => setRoute(history.getSnapshot()));
    setRoute(history.getSnapshot());
    return () => {
      unsubscribe();
      history.dispose();
      controller.current = null;
    };
  }, []);

  const navigate = useCallback((target: string | SupportedRoute, options: NavigateOptions = {}) => {
    const activeController = controller.current;
    if (!activeController) return;

    let next: Route;
    if (typeof target === 'string') {
      next = parseRoute(target, window.location.href);
      if (next.type === 'unsupported') {
        if (options.replace) window.location.replace(target);
        else window.location.assign(target);
        return;
      }

      const hasExplicitSidebarState = next.query.some(([key]) => key === 'sidebar');
      const current = activeController.getSnapshot();
      if (!hasExplicitSidebarState && current.type !== 'unsupported' && current.sidebarCollapsed) {
        next = { ...next, sidebarCollapsed: true };
      }
    } else {
      next = target;
    }

    activeController.navigate(next as SupportedRoute, options);
    setRoute(activeController.getSnapshot());
  }, []);

  return <RouteNavigationContext.Provider value={{ route, navigate }}>{children}</RouteNavigationContext.Provider>;
}

export function useRouteNavigation() {
  const navigation = useContext(RouteNavigationContext);
  if (!navigation) throw new Error('Route navigation provider is missing');
  return navigation;
}

export function handleRouteClick<T extends HTMLElement>(event: MouseEvent<T>, navigate: AppNavigate) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const anchor = target.closest('a[href]');
  if (!(anchor instanceof HTMLAnchorElement) || !event.currentTarget.contains(anchor)) return;
  if (!isPlainLinkEligible(event.nativeEvent, anchor, window.location.href)) return;
  event.preventDefault();
  navigate(anchor.href);
}

