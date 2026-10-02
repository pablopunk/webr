import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TerminalKeyBar } from '../../src/components/TerminalKeyBar';
import { controlCharacter } from '../../src/components/TerminalInput';

afterEach(cleanup);

it('sends Tab and arrow bytes and reflects the armed Ctrl state', async () => {
  const onBytes = vi.fn(); const onToggleCtrl = vi.fn();
  const { rerender } = render(<TerminalKeyBar ctrl={false} onToggleCtrl={onToggleCtrl} onBytes={onBytes} />);
  const user = userEvent.setup();
  for (const name of ['Tab', 'Up', 'Down', 'Left', 'Right']) await user.click(screen.getByRole('button', { name }));
  expect(onBytes.mock.calls.map(([bytes]) => bytes)).toEqual(['\t', '\x1b[A', '\x1b[B', '\x1b[D', '\x1b[C']);
  await user.click(screen.getByRole('button', { name: 'Ctrl' }));
  expect(onToggleCtrl).toHaveBeenCalledOnce();
  rerender(<TerminalKeyBar ctrl onToggleCtrl={onToggleCtrl} onBytes={onBytes} />);
  expect(screen.getByRole('button', { name: 'Ctrl' }).getAttribute('aria-pressed')).toBe('true');
});

it('turns letters into control characters and leaves other text alone', () => {
  expect([controlCharacter('c'), controlCharacter('D'), controlCharacter('['), controlCharacter('1'), controlCharacter('ab')]).toEqual(['\x03', '\x04', '\x1b', undefined, undefined]);
});
