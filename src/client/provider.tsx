import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRuntimeStore, createUiStore } from './store';
import { BrowserTerminalManager } from './terminal-manager';
import type { Bootstrap } from '../shared/runtime';

const Context = createContext<{ runtime: ReturnType<typeof createRuntimeStore>; ui: ReturnType<typeof createUiStore>; terminals: BrowserTerminalManager } | null>(null);
export function RuntimeProvider({ bootstrap, children }: { bootstrap: Bootstrap; children: ReactNode }) {
  const [value] = useState(() => {
    const runtime = createRuntimeStore(bootstrap);
    const ui = createUiStore();
    return { runtime, ui, terminals: new BrowserTerminalManager((projection) => runtime.getState().install(projection), (connected) => runtime.getState().connection(connected)) };
  });
  const [query] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: false } } }));
  useEffect(() => { value.terminals.start(); return () => value.terminals.stop(); }, [value]);
  return <Context.Provider value={value}><QueryClientProvider client={query}>{children}</QueryClientProvider></Context.Provider>;
}
export function useRuntime() { const value = useContext(Context); if (!value) throw new Error('Runtime provider is missing'); return value; }
export function useRuntimeSelector<T>(selector: (state: ReturnType<ReturnType<typeof createRuntimeStore>['getState']>) => T) { return useStore(useRuntime().runtime, selector); }
