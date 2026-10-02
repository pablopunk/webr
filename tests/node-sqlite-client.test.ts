import { expect, it } from 'vitest';
import { NodeSqliteClient } from '../src/server/storage/node-sqlite-client';

function clientWithCounter() {
  const client = new NodeSqliteClient(':memory:');
  client.exec('CREATE TABLE counter (n INTEGER NOT NULL)');
  return client;
}
const count = (client: NodeSqliteClient) => client.prepare('SELECT count(*) AS total FROM counter').get() as { total: number };

it('commits a transaction and returns its result', () => {
  const client = clientWithCounter();
  const insert = client.transaction((n: number) => { client.prepare('INSERT INTO counter VALUES (?)').run(n); return n * 2; });
  expect(insert.immediate(2)).toBe(4);
  expect(count(client).total).toBe(1);
});

it('rolls back a transaction that throws and rethrows the error', () => {
  const client = clientWithCounter();
  const failing = client.transaction(() => { client.prepare('INSERT INTO counter VALUES (1)').run(); throw new Error('boom'); });
  expect(() => failing()).toThrow('boom');
  expect(count(client).total).toBe(0);
});

it('returns rows as arrays only after raw()', () => {
  const client = clientWithCounter();
  client.prepare('INSERT INTO counter VALUES (7)').run();
  expect(client.prepare('SELECT n FROM counter').raw().all()).toEqual([[7]]);
  expect(client.prepare('SELECT n FROM counter').all()).toEqual([{ n: 7 }]);
});
