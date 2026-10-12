import { useLayoutEffect, useRef, type RefObject } from 'react';

const durationMs = 160;
const itemSelector = '[data-flip-id]';

const contentTops = (container: HTMLElement) => {
  const origin = container.getBoundingClientRect().top - container.scrollTop;
  return new Map([...container.querySelectorAll<HTMLElement>(itemSelector)].map((element) => [element.dataset.flipId!, { element, top: element.getBoundingClientRect().top - origin }]));
};

export function useFlipList(container: RefObject<HTMLElement | null>, resetKey?: unknown) {
  const previous = useRef<{ resetKey?: unknown; tops: Map<string, number> }>({ resetKey, tops: new Map() });
  useLayoutEffect(() => {
    if (!container.current) return;
    const current = contentTops(container.current);
    const prior = previous.current;
    const sameItems = prior.tops.size === current.size && [...current.keys()].every((id) => prior.tops.has(id));
    const reset = prior.resetKey !== resetKey && prior.tops.size > 0;
    if (sameItems || reset) {
      for (const [id, { element, top }] of current) {
        const before = prior.tops.get(id);
        if (before === undefined || Math.abs(before - top) < 1) continue;
        element.animate([{ transform: `translateY(${before - top}px)` }, { transform: 'none' }], { duration: durationMs, easing: 'ease-out' });
      }
    }
    previous.current = { resetKey, tops: new Map([...current].map(([id, { top }]) => [id, top])) };
  });
}
