import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { detectedAgentKinds } from '../src/shared/agent-kinds';

it('has a generated icon asset for every registered harness', async () => {
  const icons = await readdir(resolve(import.meta.dirname, '..', 'public', 'harness-icons'));
  expect(detectedAgentKinds.filter((id) => !icons.includes(`${id}.png`))).toEqual([]);
});
