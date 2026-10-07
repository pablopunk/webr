import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { HarnessIcon } from '../../src/components/HarnessIcon';
import { herdrAgentKinds } from '../../src/shared/agent-kinds';

afterEach(cleanup);

it('renders the generated icon for every registered harness and only falls back for unknown ids', () => {
  for (const harness of herdrAgentKinds) {
    const { container, unmount } = render(<HarnessIcon harness={harness} />);
    expect(container.querySelector('img')?.getAttribute('src'), harness).toBe(`/harness-icons/${harness}.png`);
    expect(container.querySelector('.harness-icon-letter'), harness).toBeNull();
    unmount();
  }

  const { container } = render(<HarnessIcon harness="unknown-harness" />);
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('.harness-icon-letter')?.textContent).toBe('U');
});
