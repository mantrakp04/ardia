import { openDatabaseSync, type SQLiteDatabase } from "expo-sqlite";
import type { SqlDatabase, SqlValue } from "../lib/sqlDatabase";

function bind(native: SQLiteDatabase): SqlDatabase {
  const params = (values: readonly SqlValue[] | undefined) => (values ? [...values] : []);
  return {
    exec: (sql) => native.execSync(sql),
    run: (sql, values) => void native.runSync(sql, params(values)),
    all: <T>(sql: string, values?: readonly SqlValue[]) => native.getAllSync<T>(sql, params(values)),
    first: <T>(sql: string, values?: readonly SqlValue[]) => native.getFirstSync<T>(sql, params(values)),
    transaction: (work) => native.withTransactionSync(work),
  };
}

export function openSqlDatabase(name: string): SqlDatabase {
  const native = openDatabaseSync(name);
  native.execSync("PRAGMA journal_mode = WAL");
  return bind(native);
}

export const openMemoryDatabase = (): SqlDatabase => bind(openDatabaseSync(":memory:"));
