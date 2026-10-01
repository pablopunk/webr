import { afterEach, expect, it, vi } from 'vitest';
import { retryDelay } from '../src/shared/retry';
import { TargetSupervisor } from '../src/server/runtime/supervisor';
import { FakeTarget } from './fixtures/target';
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
it('bounds jittered exponential retries instead of permanent 100ms or one-second hot loops', async () => {
  expect(retryDelay(0, () => 0)).toBe(800); expect(retryDelay(0, () => 1)).toBe(1200); expect(retryDelay(20, () => 1)).toBe(30_000);
  vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0.5); const target = new FakeTarget(); target.subscribe = vi.fn(async () => { throw new Error('connection_not_approved'); });
  const supervisor = new TargetSupervisor(target, () => {}); await supervisor.start();
  await vi.advanceTimersByTimeAsync(999); expect(target.subscribe).toHaveBeenCalledTimes(1); await vi.advanceTimersByTimeAsync(1); expect(target.subscribe).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1999); expect(target.subscribe).toHaveBeenCalledTimes(2); await vi.advanceTimersByTimeAsync(1); expect(target.subscribe).toHaveBeenCalledTimes(3); supervisor.stop();
});
