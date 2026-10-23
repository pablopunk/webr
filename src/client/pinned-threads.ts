import { useSyncExternalStore } from 'react';
import type { Thread } from '../lib/models';
import { threadStateKey } from './store';

export type DropEdge = 'before' | 'after';

const storageKey = 'webr-pinned-threads';
const noPins: string[] = [];
const listeners = new Set<() => void>();
let keys: string[] | undefined;

const readStored = () => {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
    return Array.isArray(stored) ? stored.filter((key): key is string => typeof key === 'string') : [];
  } catch { return []; }
};
const load = () => keys ??= readStored();
const commit = (next: string[]) => {
  keys = next;
  try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Keep the pins in memory when storage is unavailable. */ }
  listeners.forEach((listener) => listener());
};
const subscribe = (listener: () => void) => {
  if (!listeners.size) keys = undefined;
  const onStorage = (event: StorageEvent) => { if (event.key === storageKey) { keys = undefined; listener(); } };
  listeners.add(listener);
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(listener); window.removeEventListener('storage', onStorage); };
};

export const pinKey = (thread: Pick<Thread, 'machineId' | 'id'>) => threadStateKey(thread.machineId, thread.id);

export const togglePin = (key: string) => commit(load().includes(key) ? load().filter((item) => item !== key) : [key, ...load()]);

export function movePin(key: string, targetKey: string, edge: DropEdge) {
  if (key === targetKey) return;
  const rest = load().filter((item) => item !== key);
  const target = rest.indexOf(targetKey);
  if (target < 0) return;
  rest.splice(edge === 'before' ? target : target + 1, 0, key);
  commit(rest);
}

export function pinnedFirst<T extends Pick<Thread, 'machineId' | 'id'>>(threads: T[], pinned: string[]): T[] {
  if (!pinned.length) return threads;
  const rank = (thread: T) => { const index = pinned.indexOf(pinKey(thread)); return index < 0 ? pinned.length : index; };
  return [...threads].sort((left, right) => rank(left) - rank(right));
}

export const usePinnedKeys = () => useSyncExternalStore(subscribe, load, () => noPins);
