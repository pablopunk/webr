import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Sidebar } from '../../src/components/Sidebar';
import { exampleThreads } from '../../src/lib/models';

vi.mock('astro:transitions/client', () => ({ navigate: vi.fn() }));

afterEach(() => { cleanup(); localStorage.clear(); });
const threads = exampleThreads().slice(0, 3);
const renderSidebar = () => render(<Sidebar projects={[]} threads={threads} archived={[]} machines={[{ id: threads[0].machineId, name: 'Local', connected: true, session: 'default', projectPaths: {}, harnesses: [], writable: true }]} mode="threads" onModeChange={() => {}} collapsed={false} mobileOpen={false} onCollapse={() => {}} onCloseMobile={() => {}} />);
const titles = () => screen.getAllByRole('link').filter((link) => link.classList.contains('thread-row')).map((link) => link.getAttribute('aria-label')!.split(' · ')[0]);
const pinButton = (title: string, action = 'Pin') => screen.getByRole('button', { name: `${action} ${title}` });
const itemOf = (title: string) => screen.getByRole('link', { name: new RegExp(`^${title} ·`) }).closest('.thread-item') as HTMLElement;
const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };

it('pins a thread to the top and unpins it with the same button', () => {
  renderSidebar();
  const [first, , third] = titles();
  fireEvent.click(pinButton(third));
  expect(titles()[0]).toBe(third);
  expect(pinButton(third, 'Unpin').getAttribute('aria-pressed')).toBe('true');
  expect(JSON.parse(localStorage.getItem('webr-pinned-threads')!)).toHaveLength(1);
  fireEvent.click(pinButton(third, 'Unpin'));
  expect(titles()[0]).toBe(first);
  expect(titles()[2]).toBe(third);
});

it('keeps pins across a remount', () => {
  const view = renderSidebar();
  const second = titles()[1];
  fireEvent.click(pinButton(second));
  view.unmount();
  renderSidebar();
  expect(titles()[0]).toBe(second);
});

it('reorders pinned threads by drag and drop', () => {
  renderSidebar();
  const [first, second] = titles();
  fireEvent.click(pinButton(first));
  fireEvent.click(pinButton(second));
  expect(titles().slice(0, 2)).toEqual([second, first]);
  expect(itemOf(second).getAttribute('draggable')).toBe('true');
  fireEvent.dragStart(itemOf(second), { dataTransfer });
  fireEvent.dragOver(itemOf(first), { dataTransfer, clientY: 1 });
  expect(itemOf(first).classList.contains('drop-after')).toBe(true);
  fireEvent.drop(itemOf(first), { dataTransfer, clientY: 1 });
  expect(titles().slice(0, 2)).toEqual([first, second]);
  expect(itemOf(first).className).not.toMatch(/drop-/);
});

it('does not make unpinned threads draggable', () => {
  renderSidebar();
  expect(itemOf(titles()[0]).getAttribute('draggable')).not.toBe('true');
});
