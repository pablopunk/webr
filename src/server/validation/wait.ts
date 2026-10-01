import type { ValidatorTransport } from './contracts';
export async function waitFor<T>(transport: Pick<ValidatorTransport, 'now' | 'sleep'>, read: () => Promise<T>, matches: (value: T) => boolean, label: string, timeout = 5000): Promise<T> {
  const end = transport.now() + timeout;
  do { const value = await read(); if (matches(value)) return value; await transport.sleep(25); } while (transport.now() < end);
  throw new Error('Timed out waiting for observed ' + label);
}
