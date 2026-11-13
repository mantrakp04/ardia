export type SqlValue = string | number | null;

export type SqlDatabase = {
  exec(sql: string): void;
  run(sql: string, params?: readonly SqlValue[]): void;
  all<T>(sql: string, params?: readonly SqlValue[]): T[];
  first<T>(sql: string, params?: readonly SqlValue[]): T | null;
  transaction(work: () => void): void;
};
