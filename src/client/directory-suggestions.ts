import { useEffect, useState } from 'react';

const looksLikePath = (value: string) => value.startsWith('/') || value.startsWith('~');
const onlyStrings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];

export function useDirectorySuggestions(machineId: string, prefix: string) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  useEffect(() => {
    if (!looksLikePath(prefix)) { setSuggestions([]); return; }
    const controller = new AbortController();
    fetch(`/api/directories?machineId=${encodeURIComponent(machineId)}&prefix=${encodeURIComponent(prefix)}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : [])
      .then((body) => setSuggestions(onlyStrings(body)))
      .catch(() => {});
    return () => controller.abort();
  }, [machineId, prefix]);
  return suggestions;
}
