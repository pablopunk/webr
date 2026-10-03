const COARSE_POINTER = '(pointer: coarse)';
const KEYBOARD_MIN_HEIGHT = 120;

export function trackVisualViewport() {
  const viewport = window.visualViewport;
  if (!viewport || !matchMedia(COARSE_POINTER).matches) return () => {};
  const root = document.documentElement;
  let tallestViewport = viewport.height;
  const sync = () => {
    tallestViewport = Math.max(tallestViewport, viewport.height, window.innerHeight);
    root.style.setProperty('--app-height', `${viewport.height}px`);
    root.style.setProperty('--app-top', `${viewport.offsetTop}px`);
    root.toggleAttribute('data-keyboard-open', tallestViewport - viewport.height > KEYBOARD_MIN_HEIGHT);
  };
  sync();
  const forgetTallestViewport = () => { tallestViewport = 0; sync(); };
  viewport.addEventListener('resize', sync); viewport.addEventListener('scroll', sync); window.addEventListener('orientationchange', forgetTallestViewport);
  return () => {
    window.removeEventListener('orientationchange', forgetTallestViewport);
    viewport.removeEventListener('resize', sync); viewport.removeEventListener('scroll', sync);
    root.style.removeProperty('--app-height'); root.style.removeProperty('--app-top'); root.removeAttribute('data-keyboard-open');
  };
}

export function matchesCoarsePointer() { return typeof matchMedia === 'function' && matchMedia(COARSE_POINTER).matches; }
