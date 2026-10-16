import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Sidebar } from '../../src/components/Sidebar';
import { exampleThreads, projects } from '../../src/lib/models';
import type { Thread } from '../../src/lib/models';

vi.mock('astro:transitions/client', () => ({ navigate: vi.fn() }));
vi.mock('bot-avatars', async (importOriginal) => {
  const actual = await importOriginal<typeof import('bot-avatars')>();
  return { ...actual, BotAvatar: ({ paused }: { paused?: boolean }) => <span data-testid="thread-avatar" data-paused={String(!!paused)} /> };
});

const positions = new Map<string, number>();
const animate = vi.fn();
const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');

const sidebar = (threads: Thread[], currentId?: string, mode: 'projects' | 'threads' = 'projects') => <Sidebar projects={projects} threads={threads} machines={[]} currentId={currentId} currentMachineId={threads.find((thread) => thread.id === currentId)?.machineId} mode={mode} onModeChange={() => {}} collapsed={false} mobileOpen={false} onCollapse={() => {}} onCloseMobile={() => {}} />;

it('keeps the same project icon mounted when selecting and deselecting a thread', () => {
  const threads = exampleThreads();
  const { rerender } = render(sidebar(threads, undefined, 'threads'));
  const row = document.querySelector<HTMLAnchorElement>(`a[href="/threads/${threads[0].id}"]`)!;
  const icon = row.querySelector('.thread-project-slot > .thread-project');
  expect(icon).not.toBeNull();
  expect(row.querySelector('.has-project-avatar .thread-bot-avatar')).not.toBeNull();

  rerender(sidebar(threads, threads[0].id, 'threads'));
  expect(row.classList.contains('is-current')).toBe(true);
  expect(row.querySelector('.thread-project-slot > .thread-project')).toBe(icon);
  const slot = row.querySelector<HTMLElement>('.thread-project-slot')!;
  expect(slot.style.getPropertyValue('--project-offset-x')).toBe('0px');
  expect(slot.style.getPropertyValue('--project-offset-y')).toBe('0px');

  rerender(sidebar(threads, undefined, 'threads'));
  expect(row.classList.contains('is-current')).toBe(false);
  expect(row.querySelector('.thread-project-slot > .thread-project')).toBe(icon);
});

it('provides a project avatar in grouped mode without adding an inline project icon', () => {
  const threads = exampleThreads();
  render(sidebar(threads, threads[0].id));
  const row = document.querySelector(`a[href="/threads/${threads[0].id}"]`)!;
  expect(row.querySelector('.thread-selected-project > .thread-project')).not.toBeNull();
  expect(row.querySelector('.thread-project-slot')).toBeNull();
});

it('keeps thread avatars still', () => {
  render(sidebar(exampleThreads()));
  expect(screen.getAllByTestId('thread-avatar').every((avatar) => avatar.getAttribute('data-paused') === 'true')).toBe(true);
});

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

it('animates neighboring threads when a project is collapsed or expanded', () => {
  const threads = exampleThreads();
  threads.forEach((thread, index) => positions.set(thread.id, index * 80));
  render(sidebar(threads));

  positions.set('fix-editor-loading', 60);
  fireEvent.click(document.querySelector('.group-title')!);
  expect(animate).toHaveBeenCalled();

  animate.mockClear();
  positions.set('fix-editor-loading', 240);
  fireEvent.click(document.querySelector('.group-title')!);
  expect(animate).toHaveBeenCalled();
});

it('animates thread ordering but not additions or removals', () => {
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
  expect(animate).not.toHaveBeenCalled();

  animate.mockClear();
  threads.forEach((thread, index) => positions.set(thread.id, index * 80));
  rerender(sidebar(threads));
  expect(animate).not.toHaveBeenCalled();
});
