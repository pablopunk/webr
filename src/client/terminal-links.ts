export function openLinkOnModifierClick(event: MouseEvent, uri: string) {
  if (!event.metaKey && !event.ctrlKey) return;
  window.open(uri, '_blank', 'noopener,noreferrer');
}
