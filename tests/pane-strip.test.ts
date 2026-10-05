import { expect, it } from 'vitest';
import { insertAfter, orderPanes, windowStartShowing } from '../src/lib/pane-strip';

it('orders panes by the saved order and keeps unknown panes at the end', () => {
  expect(orderPanes([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }], ['c', 'a', 'gone']).map((pane) => pane.id)).toEqual(['c', 'a', 'b', 'd']);
});
it('inserts a pane after another pane', () => {
  expect(insertAfter(['a', 'b', 'c'], 'a', 'n')).toEqual(['a', 'n', 'b', 'c']);
  expect(insertAfter(['a'], 'gone', 'n')).toEqual(['a', 'n']);
});
it('moves the window only as far as needed to show a pane', () => {
  expect(windowStartShowing(3, 1, 0)).toBe(0);
  expect(windowStartShowing(6, 2, 3)).toBe(2);
  expect(windowStartShowing(6, 2, 5)).toBe(4);
  expect(windowStartShowing(6, 4, 1)).toBe(1);
});
it('keeps the window inside the strip when panes close', () => {
  expect(windowStartShowing(2, 3, -1)).toBe(0);
  expect(windowStartShowing(1, 0, 0)).toBe(0);
});
