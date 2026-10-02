import { useSyncExternalStore } from 'react';
import { perfSnapshot, perfVisible, subscribePerf } from '../client/perf';

export function PerfOverlay() {
  const visible = useSyncExternalStore(subscribePerf, perfVisible, () => false);
  const { rates } = useSyncExternalStore(subscribePerf, perfSnapshot, perfSnapshot);
  return visible ? <aside className="perf-overlay" aria-label="Frames per second">{Math.round(rates.frames ?? 0)} fps</aside> : null;
}
