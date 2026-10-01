import { useQuery } from '@tanstack/react-query';
import type { Machine } from '../lib/machines';

export function useMachineCatalog(machineId: string, connected: boolean, configVersion = 1, session = '', projectId = '') {
  return useQuery({ queryKey: ['machine-catalog', machineId, session, configVersion, projectId], enabled: !!machineId && connected, queryFn: async ({ signal }) => {
    const response = await fetch('/api/catalog/' + encodeURIComponent(machineId) + (projectId ? '?projectId=' + encodeURIComponent(projectId) : ''), { signal });
    if (!response.ok) throw new Error('Machine catalog is not available.');
    return await response.json() as Machine;
  } });
}
