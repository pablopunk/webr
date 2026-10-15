import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MobileTopBar } from '../../src/components/MobileTopBar';
import type { Pane } from '../../src/lib/models';

afterEach(cleanup);
const panes: Pane[] = [{ id: 'a', title: 'One', kind: 'shell', terminalId: 'ta' }, { id: 'b', title: 'Two', kind: 'shell', terminalId: 'tb' }];
const bar = (shown: Pane[], focusedPane = 'b') => {
  const handlers = { onFocusPane: vi.fn(), onOpenSidebar: vi.fn(), onOpenPalette: vi.fn(), keepTerminalFocus: vi.fn() };
  render(<MobileTopBar panes={shown} focusedPane={focusedPane} {...handlers} />);
  return handlers;
};

it('opens the sidebar and the command palette from the bar', () => {
  const { onOpenSidebar, onOpenPalette } = bar(panes);
  fireEvent.click(screen.getByRole('button', { name: 'Open sidebar' })); fireEvent.click(screen.getByRole('button', { name: 'Open command palette' }));
  expect(onOpenSidebar).toHaveBeenCalled(); expect(onOpenPalette).toHaveBeenCalled();
});
it('marks the focused pane and focuses another on tap', () => {
  const { onFocusPane } = bar(panes);
  expect(screen.getByRole('tab', { name: 'Two' }).getAttribute('aria-selected')).toBe('true');
  fireEvent.click(screen.getByRole('tab', { name: 'One' })); expect(onFocusPane).toHaveBeenCalledWith('a');
});
it('always shows at least one tab', () => {
  bar([]);
  expect(screen.getAllByRole('tab')).toHaveLength(1);
});
