import { useQuery } from '@tanstack/react-query';
import { isAccessLossError, useRuntimeCacheScope } from './provider';

const looksLikePath = (value: string) => value.startsWith('/') || value.startsWith('~');
const onlyStrings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
export const directorySuggestionsQueryKey = (machineId: string, session: string, configVersion: number, prefix: string, cacheScope: string) =>
  ['directory-suggestions', machineId, configVersion, session, prefix, cacheScope] as const;

export function useDirectorySuggestions(machineId: string, prefix: string, session = '', configVersion = 1) {
  const cacheScope = useRuntimeCacheScope();
  const query = useQuery<string[]>({
    queryKey: directorySuggestionsQueryKey(machineId, session, configVersion, prefix, cacheScope),
    enabled: !!machineId && looksLikePath(prefix),
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/directories?machineId=${encodeURIComponent(machineId)}&prefix=${encodeURIComponent(prefix)}`, { signal });
      if (!response.ok) throw Object.assign(new Error('Could not load directory suggestions.'), { status: response.status });
      return onlyStrings(await response.json());
    },
  });
  return isAccessLossError(query.error) ? { ...query, data: undefined } : query;
}
