import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CommandPalette } from '../../src/components/CommandPalette';
import { exampleThreads } from '../../src/lib/models';

vi.mock('astro:transitions/client', () => ({ navigate: vi.fn() }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

const renderPalette = () => render(<CommandPalette open onClose={() => {}} projects={[]} threads={[]} machines={[]}
  thread={{ ...exampleThreads()[0], bindingState: 'attached' as const }} focusedPane="w1:p4"
  mode="threads" onModeChange={() => {}} onToggleSidebar={() => {}} onFocusPane={() => {}}
  onTerminalAction={() => {}} onOpenTerminal={() => {}} onClosePane={() => {}} />);

it('finds New split through pane and terminal keywords', () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
  renderPalette();
  const input = screen.getByRole('textbox', { name: 'Search commands and threads' });
  fireEvent.change(input, { target: { value: 'pane' } });
  expect(screen.getByRole('option', { name: /New split/ })).toBeTruthy();
  expect(screen.getByRole('option', { name: /Close pane/ })).toBeTruthy();
  expect(screen.getByRole('option', { name: /Next pane/ })).toBeTruthy();
  fireEvent.change(input, { target: { value: 'split' } });
  expect(screen.getByRole('option', { name: /New split/ })).toBeTruthy();
  expect(screen.queryByRole('option', { name: /Close pane/ })).toBeNull();
  fireEvent.change(input, { target: { value: 'terminal' } });
  expect(screen.getByRole('option', { name: /New split/ })).toBeTruthy();
});
