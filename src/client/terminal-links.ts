const isModifierClick = (event: MouseEvent) => event.metaKey || event.ctrlKey;

export function openLinkOnModifierClick(event: MouseEvent, uri: string) {
  if (!isModifierClick(event)) return;
  window.open(uri, '_blank', 'noopener,noreferrer');
}
