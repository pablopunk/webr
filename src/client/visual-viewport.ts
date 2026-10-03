const COARSE_POINTER = '(pointer: coarse)';
const KEYBOARD_MIN_HEIGHT = 120;
const KEYBOARD_ANIMATION_MS = 350;

export function trackVisualViewport() {
  const viewport = window.visualViewport;
  if (!viewport || !matchMedia(COARSE_POINTER).matches) return () => {};
  const root = document.documentElement;
  let tallestViewport = viewport.height;
  const fitToKeyboard = () => { root.style.setProperty('--app-height', `${viewport.height}px`); root.style.setProperty('--app-top', `${viewport.offsetTop}px`); };
  const fillScreen = () => { root.style.removeProperty('--app-height'); root.style.removeProperty('--app-top'); };
  const sync = () => {
    tallestViewport = Math.max(tallestViewport, viewport.height, window.innerHeight);
    const keyboardOpen = tallestViewport - viewport.height > KEYBOARD_MIN_HEIGHT;
    if (keyboardOpen) fitToKeyboard(); else fillScreen();
    root.toggleAttribute('data-keyboard-open', keyboardOpen);
  };
  sync();
  let settle: ReturnType<typeof setTimeout> | undefined;
  const syncAfterKeyboardAnimation = () => { clearTimeout(settle); settle = setTimeout(sync, KEYBOARD_ANIMATION_MS); };
  const forgetTallestViewport = () => { tallestViewport = 0; sync(); };
  viewport.addEventListener('resize', sync); viewport.addEventListener('scroll', sync); window.addEventListener('orientationchange', forgetTallestViewport);
  window.addEventListener('focusout', syncAfterKeyboardAnimation); window.addEventListener('focusin', syncAfterKeyboardAnimation);
  return () => {
    clearTimeout(settle);
    window.removeEventListener('focusout', syncAfterKeyboardAnimation); window.removeEventListener('focusin', syncAfterKeyboardAnimation);
    window.removeEventListener('orientationchange', forgetTallestViewport);
    viewport.removeEventListener('resize', sync); viewport.removeEventListener('scroll', sync);
    fillScreen(); root.removeAttribute('data-keyboard-open');
  };
}

export function matchesCoarsePointer() { return typeof matchMedia === 'function' && matchMedia(COARSE_POINTER).matches; }
