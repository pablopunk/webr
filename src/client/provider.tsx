import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRuntimeStore, createUiStore } from './store';
import { BrowserTerminalManager } from './terminal-manager';
import { span } from './perf';
import type { Bootstrap } from '../shared/runtime';

const Context = createContext<{ runtime: ReturnType<typeof createRuntimeStore>; ui: ReturnType<typeof createUiStore>; terminals: BrowserTerminalManager; cacheScope: string } | null>(null);
export function isAccessLossError(error: unknown) {
  return typeof error === 'object' && error !== null && 'status' in error && (error.status === 401 || error.status === 403);
}
export function RuntimeProvider({ bootstrap, children }: { bootstrap: Bootstrap; children: ReactNode }) {
  const [value] = useState(() => {
    const runtime = createRuntimeStore(bootstrap);
    const ui = createUiStore();
    return { runtime, ui, terminals: new BrowserTerminalManager((projection) => { const done = span('projectionInstallMs'); const accepted = runtime.getState().install(projection); done(); return accepted; }, (connected) => runtime.getState().connection(connected)) };
  });
  const [query] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: false } } }));
  const cacheScope = useRef(bootstrap.recoveryScope);
  useEffect(() => {
    if (cacheScope.current === bootstrap.recoveryScope) return;
    cacheScope.current = bootstrap.recoveryScope;
    query.clear();
  }, [bootstrap.recoveryScope, query]);
  useEffect(() => query.getQueryCache().subscribe((event) => {
    if (event.type === 'updated' && event.action.type === 'error' && isAccessLossError(event.query.state.error)) query.clear();
  }), [query]);
  useEffect(() => { value.runtime.getState().connection(false); value.terminals.start(); return () => value.terminals.stop(); }, [value]);
  const contextValue = useMemo(() => ({ ...value, cacheScope: bootstrap.recoveryScope }), [value, bootstrap.recoveryScope]);
  return <Context.Provider value={contextValue}><QueryClientProvider client={query}>{children}</QueryClientProvider></Context.Provider>;
}
export function useRuntime() { const value = useContext(Context); if (!value) throw new Error('Runtime provider is missing'); return value; }
export function useRuntimeCacheScope() { return useContext(Context)?.cacheScope ?? ''; }
export function useRuntimeSelector<T>(selector: (state: ReturnType<ReturnType<typeof createRuntimeStore>['getState']>) => T) { return useStore(useRuntime().runtime, selector); }
