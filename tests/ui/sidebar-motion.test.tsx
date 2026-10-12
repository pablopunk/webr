import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { Sidebar } from '../../src/components/Sidebar';
import { exampleThreads, projects } from '../../src/lib/models';
import type { Thread } from '../../src/lib/models';

vi.mock('astro:transitions/client', () => ({ navigate: vi.fn() }));

const positions = new Map<string, number>();
const animate = vi.fn();
const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');

const sidebar = (threads: Thread[]) => <Sidebar projects={projects} threads={threads} machines={[]} mode="projects" onModeChange={() => {}} collapsed={false} mobileOpen={false} onCollapse={() => {}} onCloseMobile={() => {}} />;

beforeEach(() => {
  positions.clear();
  animate.mockClear();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const top = positions.get(this.dataset.flipId ?? '') ?? 0;
    return { x: 0, y: top, top, left: 0, right: 0, bottom: top, width: 0, height: 0, toJSON: () => ({}) };
  });
  Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: animate });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (originalAnimate) Object.defineProperty(Element.prototype, 'animate', originalAnimate);
  else Reflect.deleteProperty(Element.prototype, 'animate');
});

it('does not animate neighboring threads when a project is collapsed or expanded', () => {
  const threads = exampleThreads();
  threads.forEach((thread, index) => positions.set(thread.id, index * 80));
  render(sidebar(threads));

  positions.set('fix-editor-loading', 60);
  fireEvent.click(document.querySelector('.group-title')!);
  expect(animate).not.toHaveBeenCalled();

  positions.set('fix-editor-loading', 240);
  fireEvent.click(document.querySelector('.group-title')!);
  expect(animate).not.toHaveBeenCalled();
});

it('animates thread ordering, additions, and removals', () => {
  const threads = exampleThreads();
  threads.forEach((thread, index) => positions.set(thread.id, index * 80));
  const { rerender } = render(sidebar(threads));

  const reordered = [threads[0], threads[2], threads[1], ...threads.slice(3)];
  reordered.forEach((thread, index) => positions.set(thread.id, index * 80));
  rerender(sidebar(reordered));
  expect(animate).toHaveBeenCalled();

  animate.mockClear();
  const addedThread = { ...threads[1], id: 'added-thread', title: 'Added test thread' };
  const withAdded = [threads[0], addedThread, ...threads.slice(1)];
  withAdded.forEach((thread, index) => positions.set(thread.id, index * 80));
  rerender(sidebar(withAdded));
  expect(animate).toHaveBeenCalled();

  animate.mockClear();
  threads.forEach((thread, index) => positions.set(thread.id, index * 80));
  rerender(sidebar(threads));
  expect(animate).toHaveBeenCalled();
});
