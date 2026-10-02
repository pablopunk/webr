import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sidebar } from '../../src/components/Sidebar';

vi.mock('astro:transitions/client', () => ({ navigate: vi.fn() }));

afterEach(cleanup);

it('closes the mobile sidebar when a navigation link is used', async () => {
  const close = vi.fn();
  render(<Sidebar projects={[]} threads={[]} machines={[]} mode="threads" onModeChange={() => {}} collapsed={false}
    mobileOpen onCollapse={() => {}} onCloseMobile={close} />);
  const link = screen.getByRole('link', { name: 'Settings' });
  link.addEventListener('click', (event) => event.preventDefault());
  await userEvent.setup().click(link);
  expect(close).toHaveBeenCalledOnce();
});
