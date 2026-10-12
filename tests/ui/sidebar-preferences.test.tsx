import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Sidebar } from '../../src/components/Sidebar';
import { exampleThreads, projects } from '../../src/lib/models';

vi.mock('astro:transitions/client', () => ({ navigate: vi.fn() }));

afterEach(() => { cleanup(); localStorage.clear(); });

const renderSidebar = () => render(<Sidebar projects={projects} threads={exampleThreads()} machines={[]} mode="projects" onModeChange={() => {}} collapsed={false} mobileOpen={false} onCollapse={() => {}} onCloseMobile={() => {}} />);

it('restores project collapse state after remounting', () => {
  const first = renderSidebar();
  const project = () => screen.getByRole('button', { name: 'herdr' });

  fireEvent.click(project());
  expect(project().getAttribute('aria-expanded')).toBe('false');
  expect(localStorage.getItem('webr-sidebar-closed-projects')).toBe('["herdr"]');

  first.unmount();
  renderSidebar();
  expect(project().getAttribute('aria-expanded')).toBe('false');

  fireEvent.click(project());
  expect(project().getAttribute('aria-expanded')).toBe('true');
  expect(localStorage.getItem('webr-sidebar-closed-projects')).toBe('[]');
});
