import { DatabaseSync } from "node:sqlite";
import type { SqlDatabase, SqlValue } from "../src/lib/sqlDatabase.ts";

export function nodeDatabase(path = ":memory:"): SqlDatabase & { close(): void } {
  const db = new DatabaseSync(path);
  const args = (values: readonly SqlValue[] | undefined) => [...(values ?? [])];
  return {
    exec: (sql) => db.exec(sql),
    run: (sql, values) => void db.prepare(sql).run(...args(values)),
    all: <T>(sql: string, values?: readonly SqlValue[]) => db.prepare(sql).all(...args(values)) as T[],
    first: <T>(sql: string, values?: readonly SqlValue[]) => (db.prepare(sql).get(...args(values)) as T | undefined) ?? null,
    transaction: (work) => {
      db.exec("BEGIN");
      try {
        work();
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    close: () => db.close(),
  };
}
