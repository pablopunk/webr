import { afterEach, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CrashReport } from '../../src/components/CrashReport';

afterEach(cleanup);

it('suppresses the expected skipped-view-transition rejection in dev', () => {
  render(<CrashReport><p>App</p></CrashReport>);
  const event = new Event('unhandledrejection', { cancelable: true });
  Object.defineProperty(event, 'reason', { value: new DOMException('Transition was skipped. New ViewTransition started', 'AbortError') });
  act(() => { window.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(true);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('lets developers dismiss frontend errors', () => {
  render(<CrashReport><p>App</p></CrashReport>);
  const event = new Event('unhandledrejection', { cancelable: true });
  Object.defineProperty(event, 'reason', { value: new Error('Unexpected failure') });
  act(() => { window.dispatchEvent(event); });
  expect(screen.getByRole('alert').textContent).toContain('Unexpected failure');
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss error' }));
  expect(screen.queryByRole('alert')).toBeNull();
});
