import { useQuery } from '@tanstack/react-query';
import type { Machine } from '../lib/machines';

const MODEL_POLL_MS = 1000;
const cacheKey = (machineId: string) => `webr-catalog:${machineId}`;
const readCachedCatalog = (machineId: string) => {
  try { return JSON.parse(localStorage.getItem(cacheKey(machineId)) ?? 'null') as Machine | null ?? undefined; } catch { return undefined; }
};
const writeCachedCatalog = (machineId: string, catalog: Machine) => { try { localStorage.setItem(cacheKey(machineId), JSON.stringify(catalog)); } catch {} };

export function useMachineCatalog(machineId: string, connected: boolean, configVersion = 1, session = '', projectId = '') {
  return useQuery<Machine>({
    queryKey: ['machine-catalog', machineId, session, configVersion, projectId], enabled: !!machineId && connected,
    placeholderData: () => readCachedCatalog(machineId),
    refetchInterval: (query) => query.state.data?.modelsPending ? MODEL_POLL_MS : false,
    queryFn: async ({ signal }) => {
      const response = await fetch('/api/catalog/' + encodeURIComponent(machineId) + (projectId ? '?projectId=' + encodeURIComponent(projectId) : ''), { signal });
      if (!response.ok) throw new Error('Machine catalog is not available.');
      const catalog = await response.json() as Machine;
      writeCachedCatalog(machineId, catalog);
      return catalog;
    },
  });
}
