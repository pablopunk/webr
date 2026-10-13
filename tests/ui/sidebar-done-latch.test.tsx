import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Sidebar } from '../../src/components/Sidebar';
import { exampleThreads } from '../../src/lib/models';

vi.mock('astro:transitions/client', () => ({ navigate: vi.fn() }));

afterEach(() => { cleanup(); });
const renderSidebar = (threads = exampleThreads().slice(0, 1)) => render(<Sidebar projects={[]} threads={threads} archived={[]} machines={[]} mode="threads" onModeChange={() => {}} collapsed={false} mobileOpen={false} onCollapse={() => {}} onCloseMobile={() => {}} />);

it('keeps the done badge from the latch even after the live status moves on', () => {
  const base = exampleThreads()[0];
  renderSidebar([{ ...base, status: 'idle', unseenDone: true, doneAt: base.updatedAt }]);
  const row = screen.getByRole('link', { name: /Build the web terminal bridge/ });
  expect(row.getAttribute('class')).toContain('needs-attention');
  expect(row.getAttribute('class')).toContain('status-done');
  expect(row.getAttribute('aria-label')).toMatch(/Done/);
});

it('shows no attention for live done that was already seen', () => {
  const base = exampleThreads()[2];
  renderSidebar([{ ...base, unseenDone: false }]);
  const row = screen.getByRole('link', { name: /Polish sidebar interactions/ });
  expect(row.getAttribute('class') ?? '').not.toContain('needs-attention');
});
