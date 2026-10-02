const HAS_SCHEME = /^[a-z][a-z\d+.-]*:\/\//i;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/i;

export const TERMINAL_URL_PATTERN = /(?:[a-z][a-z\d+.-]*:\/\/|www\.|(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+|\/))[^\s"'<>`()[\]{}]*[^\s"'<>`()[\]{}.,;:!?]/gi;

const withScheme = (uri: string) => HAS_SCHEME.test(uri) ? uri : `${LOCAL_HOST.test(uri) ? 'http' : 'https'}://${uri}`;

export function openLinkOnModifierClick(event: MouseEvent, uri: string) {
  if (!event.metaKey && !event.ctrlKey) return;
  window.open(withScheme(uri), '_blank', 'noopener,noreferrer');
}
