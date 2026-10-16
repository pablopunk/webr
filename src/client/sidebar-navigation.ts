export function sidebarNavigationHref(direction: 1 | -1): string | undefined {
  const navigation = document.querySelector('[data-sidebar-navigation="true"]');
  const items = Array.from(navigation?.querySelectorAll<HTMLElement>('[data-sidebar-navigation-item="true"]') ?? []);
  if (!items.length) return undefined;

  const currentIndex = items.findIndex((item) => item.dataset.sidebarNavigationCurrent === 'true');
  const startIndex = currentIndex >= 0 ? currentIndex : direction === 1 ? -1 : 0;
  const target = items[(startIndex + direction + items.length) % items.length];
  return target.dataset.sidebarNavigationHref;
}
