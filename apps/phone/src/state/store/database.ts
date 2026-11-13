import type { SqlDatabase } from "../../lib/sqlDatabase";
import { openMemoryDatabase, openSqlDatabase } from "../../platform/database";
import { DATABASE_FILE, migrate } from "./schema";

let opened: SqlDatabase | null = null;

export function browserDatabase(): SqlDatabase {
  if (opened) return opened;
  const file = openSqlDatabase(DATABASE_FILE);
  if ("refused" in migrate(file)) {
    const memory = openMemoryDatabase();
    migrate(memory);
    opened = memory;
  } else {
    opened = file;
  }
  return opened;
}
