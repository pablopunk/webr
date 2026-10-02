const COARSE_POINTER = '(pointer: coarse)';

export function trackVisualViewport() {
  const viewport = window.visualViewport;
  if (!viewport || !matchMedia(COARSE_POINTER).matches) return () => {};
  const root = document.documentElement;
  const sync = () => {
    root.style.setProperty('--app-height', `${viewport.height}px`);
    root.style.setProperty('--app-top', `${viewport.offsetTop}px`);
  };
  sync();
  viewport.addEventListener('resize', sync); viewport.addEventListener('scroll', sync);
  return () => {
    viewport.removeEventListener('resize', sync); viewport.removeEventListener('scroll', sync);
    root.style.removeProperty('--app-height'); root.style.removeProperty('--app-top');
  };
}

export function matchesCoarsePointer() { return typeof matchMedia === 'function' && matchMedia(COARSE_POINTER).matches; }
