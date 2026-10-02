import { useLayoutEffect, useRef, type RefObject } from 'react';

const durationMs = 220;
const itemSelector = '[data-flip-id]';

const contentTops = (container: HTMLElement) => {
  const origin = container.getBoundingClientRect().top - container.scrollTop;
  return new Map([...container.querySelectorAll<HTMLElement>(itemSelector)].map((element) => [element.dataset.flipId!, { element, top: element.getBoundingClientRect().top - origin }]));
};

export function useFlipList(container: RefObject<HTMLElement | null>) {
  const previous = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    if (!container.current) return;
    const current = contentTops(container.current);
    for (const [id, { element, top }] of current) {
      const before = previous.current.get(id);
      if (before === undefined || Math.abs(before - top) < 1) continue;
      element.animate([{ transform: `translateY(${before - top}px)` }, { transform: 'none' }], { duration: durationMs, easing: 'cubic-bezier(.2, .8, .2, 1)' });
    }
    previous.current = new Map([...current].map(([id, { top }]) => [id, top]));
  });
}
