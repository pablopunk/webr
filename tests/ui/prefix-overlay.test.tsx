import { expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach } from 'vitest';
import { PrefixOverlay } from '../../src/components/PrefixOverlay';
import { defaultShortcuts } from '../../src/components/shortcuts';

afterEach(() => cleanup());

const shortcuts = {
  ...defaultShortcuts,
  nextThread: 'ctrl+a j',
  previousThread: 'ctrl+a k',
  nextPane: 'ctrl+l',
  previousPane: 'ctrl+h',
  toggleSidebar: 'meta+b',
  newThread: 'ctrl+a c',
  openTerminal: 'ctrl+a v',
  closePane: 'ctrl+a x',
  renameThread: 'ctrl+a r',
  commandPalette: 'meta+k',
};

it('lists continuations of the armed prefix with their actions', () => {
  render(<PrefixOverlay prefix="ctrl+a" shortcuts={shortcuts} />);
  expect(screen.getByText('Next thread')).toBeTruthy();
  expect(screen.getByText('Close pane')).toBeTruthy();
  expect(screen.queryByText('Next pane')).toBeNull();
  expect(screen.queryByText('Toggle sidebar')).toBeNull();
  expect(screen.queryByText('Command palette')).toBeNull();
  expect(screen.getByText('prefix again sends it literally')).toBeTruthy();
});

it('renders nothing without continuations', () => {
  const { container } = render(<PrefixOverlay prefix="ctrl+z" shortcuts={shortcuts} />);
  expect(container.firstChild).toBeNull();
});
