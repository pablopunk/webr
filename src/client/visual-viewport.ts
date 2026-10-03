const COARSE_POINTER = '(pointer: coarse)';
const KEYBOARD_MIN_HEIGHT = 120;

export function trackVisualViewport() {
  const viewport = window.visualViewport;
  if (!viewport || !matchMedia(COARSE_POINTER).matches) return () => {};
  const root = document.documentElement;
  const sync = () => {
    root.style.setProperty('--app-height', `${viewport.height}px`);
    root.style.setProperty('--app-top', `${viewport.offsetTop}px`);
    root.toggleAttribute('data-keyboard-open', window.innerHeight - viewport.height > KEYBOARD_MIN_HEIGHT);
  };
  sync();
  viewport.addEventListener('resize', sync); viewport.addEventListener('scroll', sync);
  return () => {
    viewport.removeEventListener('resize', sync); viewport.removeEventListener('scroll', sync);
    root.style.removeProperty('--app-height'); root.style.removeProperty('--app-top'); root.removeAttribute('data-keyboard-open');
  };
}

export function matchesCoarsePointer() { return typeof matchMedia === 'function' && matchMedia(COARSE_POINTER).matches; }
