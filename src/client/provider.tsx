import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRuntimeStore, createUiStore } from './store';
import { BrowserTerminalManager } from './terminal-manager';
import { span } from './perf';
import type { Bootstrap } from '../shared/runtime';
import { defaultThreadTickets, ThreadTickets } from './create-tickets';

const Context = createContext<{ runtime: ReturnType<typeof createRuntimeStore>; ui: ReturnType<typeof createUiStore>; terminals: BrowserTerminalManager; tickets: ThreadTickets; cacheScope: string } | null>(null);
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
  const tickets = useMemo(() => new ThreadTickets(bootstrap.recoveryScope), [bootstrap.recoveryScope]);
  const ticketStore = useRef(tickets);
  useEffect(() => {
    if (ticketStore.current === tickets) return;
    ticketStore.current.clearOnAccessLoss();
    ticketStore.current = tickets;
  }, [tickets]);
  const cacheScope = useRef(bootstrap.recoveryScope);
  useEffect(() => {
    if (cacheScope.current === bootstrap.recoveryScope) return;
    cacheScope.current = bootstrap.recoveryScope;
    query.clear();
  }, [bootstrap.recoveryScope, query]);
  useEffect(() => query.getQueryCache().subscribe((event) => {
    if (event.type === 'updated' && event.action.type === 'error' && isAccessLossError(event.query.state.error)) {
      query.clear(); tickets.clearOnAccessLoss();
    }
  }), [query, tickets]);
  // Keep fresh SSR state visible; terminal control itself waits for an accepted projection.
  useEffect(() => { value.terminals.start(); return () => value.terminals.stop(); }, [value]);
  const contextValue = useMemo(() => ({ ...value, tickets, cacheScope: bootstrap.recoveryScope }), [value, tickets, bootstrap.recoveryScope]);
  return <Context.Provider value={contextValue}><QueryClientProvider client={query}>{children}</QueryClientProvider></Context.Provider>;
}
export function useRuntime() { const value = useContext(Context); if (!value) throw new Error('Runtime provider is missing'); return value; }
export function useThreadTickets() { return useContext(Context)?.tickets ?? defaultThreadTickets(); }
export function useRuntimeCacheScope() { return useContext(Context)?.cacheScope ?? ''; }
export function useRuntimeSelector<T>(selector: (state: ReturnType<ReturnType<typeof createRuntimeStore>['getState']>) => T) { return useStore(useRuntime().runtime, selector); }
