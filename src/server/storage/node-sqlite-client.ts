import { DatabaseSync, type StatementSync, type SQLInputValue } from 'node:sqlite';

export type RunResult = { changes: number | bigint; lastInsertRowid: number | bigint };
type BindValues = SQLInputValue[];
type Behavior = 'deferred' | 'immediate' | 'exclusive';

class NodeSqliteStatement {
  constructor(private readonly statement: StatementSync) { this.statement.setReturnArrays(false); }
  run(...parameters: BindValues) { return this.statement.run(...parameters); }
  all(...parameters: BindValues) { return this.statement.all(...parameters); }
  get(...parameters: BindValues) { return this.statement.get(...parameters); }
  raw() { this.statement.setReturnArrays(true); return this; }
}

function runInTransaction<Args extends unknown[], Result>(database: DatabaseSync, behavior: Behavior, work: (...args: Args) => Result) {
  return (...args: Args) => {
    database.exec(`BEGIN ${behavior}`);
    try {
      const result = work(...args);
      database.exec('COMMIT');
      return result;
    } catch (error) {
      if (database.isTransaction) database.exec('ROLLBACK');
      throw error;
    }
  };
}

/** The slice of the better-sqlite3 client API that drizzle's synchronous SQLite driver calls, backed by `node:sqlite`. */
export class NodeSqliteClient {
  private readonly database: DatabaseSync;
  constructor(path: string) { this.database = new DatabaseSync(path); }
  exec(sql: string) { this.database.exec(sql); }
  close() { this.database.close(); }
  prepare(sql: string) { return new NodeSqliteStatement(this.database.prepare(sql)); }
  transaction<Args extends unknown[], Result>(work: (...args: Args) => Result) {
    const inTransaction = (behavior: Behavior) => runInTransaction(this.database, behavior, work);
    return Object.assign(inTransaction('deferred'), {
      deferred: inTransaction('deferred'),
      immediate: inTransaction('immediate'),
      exclusive: inTransaction('exclusive'),
    });
  }
}
