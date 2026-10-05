import { useEffect, useSyncExternalStore } from 'react';
import { useStore } from 'zustand';
import type { createUiStore } from './store';
import { windowStartShowing } from '../lib/pane-strip';

const NARROW_SCREEN = '(max-width: 760px)';

export function usePaneWindowStart(ui: ReturnType<typeof createUiStore>, scope: string, paneIds: string[], focusedPane: string) {
  const stored = useStore(ui, (state) => state.paneWindows[scope] ?? 0);
  const start = windowStartShowing(paneIds.length, stored, paneIds.indexOf(focusedPane));
  useEffect(() => { if (start !== stored) ui.getState().showWindow(scope, start); }, [ui, scope, start, stored]);
  return start;
}

const subscribeToNarrowScreen = (onChange: () => void) => {
  if (typeof matchMedia !== 'function') return () => {};
  const media = matchMedia(NARROW_SCREEN); media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
};
export const isNarrowScreen = () => typeof matchMedia === 'function' && matchMedia(NARROW_SCREEN).matches;
export const useNarrowScreen = () => useSyncExternalStore(subscribeToNarrowScreen, isNarrowScreen, () => false);
