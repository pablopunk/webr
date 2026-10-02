import { createInterface } from 'node:readline/promises';

export async function confirmOnTerminal(question: string) {
  if (!process.stdin.isTTY) return false;
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await terminal.question(`${question} [y/N] `);
  terminal.close();
  return /^y(es)?$/i.test(answer.trim());
}
