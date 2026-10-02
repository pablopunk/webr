import { expect, it } from 'vitest';
import { parseModelListing } from '../src/server/transport/model-discovery';

it('reads model ids from each CLI listing format', () => {
  expect(parseModelListing('opencode', 'opencode/big-pickle\nopenai/gpt-5\n')).toEqual(['opencode/big-pickle', 'openai/gpt-5']);
  expect(parseModelListing('pi', 'provider model context\nfireworks accounts/x/y 1M\n')).toEqual(['fireworks/accounts/x/y']);
  expect(parseModelListing('codex', JSON.stringify({ models: [{ slug: 'gpt-5.5' }] }))).toEqual(['gpt-5.5']);
  expect(parseModelListing('agy', 'Fetching available models...\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\n')).toEqual(['gemini-3.8-flash-high']);
});
it('returns nothing for unknown kinds, bad output and unsafe ids', () => {
  expect(parseModelListing('claude', 'x')).toEqual([]); expect(parseModelListing('codex', 'not json')).toEqual([]); expect(parseModelListing('opencode', 'a;b\nok/id')).toEqual(['ok/id']);
});
