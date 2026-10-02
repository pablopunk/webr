import { expect, it } from 'vitest';
import { deleteWarning } from '../src/client/thread-actions';
import { exampleThreads } from '../src/lib/models';

const [plain, owner] = [exampleThreads()[0], { ...exampleThreads()[1], ownsWorktree: true }];

it('mentions a worktree only when a deleted thread owns one', () => {
  expect(deleteWarning([plain])).not.toMatch(/worktree/);
  expect(deleteWarning([plain])).toMatch(/project files stay untouched/);
  expect(deleteWarning([owner])).toMatch(/removes its worktree/);
  expect(deleteWarning([plain, owner])).toMatch(/removes 1 worktree,/);
});
