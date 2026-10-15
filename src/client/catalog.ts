import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Machine } from '../lib/machines';
import { isAccessLossError, useRuntimeCacheScope } from './provider';

const MODEL_POLL_MS = 1000;
let discardedLegacyCatalogs = false;
function discardLegacyCatalogs() {
  if (discardedLegacyCatalogs) return;
  discardedLegacyCatalogs = true;
  try {
    if (typeof localStorage === 'undefined') return;
    for (let index = localStorage.length - 1; index >= 0; index--) {
      const key = localStorage.key(index);
      if (key?.startsWith('webr-catalog:')) localStorage.removeItem(key);
    }
  } catch { /* Storage can be unavailable in restricted browser contexts. */ }
}
export const machineCatalogQueryKey = (machineId: string, configVersion: number, session: string, projectId: string, cacheScope: string) =>
  ['machine-catalog', machineId, configVersion, session, projectId, cacheScope] as const;

export function useMachineCatalog(machineId: string, connected: boolean, configVersion = 1, session = '', projectId = '') {
  const cacheScope = useRuntimeCacheScope();
  useEffect(discardLegacyCatalogs, []);
  const query = useQuery<Machine>({
    queryKey: machineCatalogQueryKey(machineId, configVersion, session, projectId, cacheScope), enabled: !!machineId && connected,
    refetchInterval: (current) => current.state.data?.modelsPending ? MODEL_POLL_MS : false,
    queryFn: async ({ signal }) => {
      const response = await fetch('/api/catalog/' + encodeURIComponent(machineId) + (projectId ? '?projectId=' + encodeURIComponent(projectId) : ''), { signal });
      if (!response.ok) throw Object.assign(new Error('Machine catalog is not available.'), { status: response.status });
      return await response.json() as Machine;
    },
  });
  return isAccessLossError(query.error) ? { ...query, data: undefined } : query;
}
