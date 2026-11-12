export type Entry = { name: string; dir: boolean; size: number; modified: number };
export type Cell = number | string | null | { blob: string };
export type Query = { sql: string; args?: (string | number)[]; limit?: number };
export type Rows = { columns: string[]; rows: Cell[][]; error?: string };
export type SnapshotFailure = "missing" | "inUse" | "unreadable" | "noTemp";
export type Secrets = { undecryptable: number; appBound: number; failure?: SnapshotFailure };
export type LoginRow = { url: string; username: string; password: string; realm?: string; created?: number; lastUsed?: number; timesUsed?: number };
export type CookieRead = Secrets & { count: number; dropped: number; token?: string };
export type WrittenCookies = { cookies: number; cookiesRejected: number; cookiesExisting: number; addresses: number; cards: number; cookiesFailed?: 1; error?: string };

export type ImportHost = {
  localAppData: string;
  roamingAppData: string;
  list(path: string): Promise<Entry[] | null | { denied: true }>;
  readText(path: string, largest: number): Promise<string | null>;
  readBase64(path: string, largest: number): Promise<string | null>;
  query(path: string, queries: Query[]): Promise<{ results: Rows[] } | { failure: SnapshotFailure }>;
  unlock(browserId: string, localState: string): Promise<{ unlocked: boolean; appBound: boolean }>;
  logins(browserId: string, files: string[]): Promise<Secrets & { items: LoginRow[] }>;
  cookies(browserId: string, file: string): Promise<CookieRead>;
  writeCookies(token: string, profile: string): Promise<WrittenCookies>;
  discard(token: string): void;
  forget(): void;
};

export const join = (...parts: string[]) =>
  parts
    .filter((part) => part !== "" && part !== ".")
    .map((part, i) => (i === 0 ? part.replace(/[\\/]+$/, "") : part.replace(/^[\\/]+|[\\/]+$/g, "")))
    .join("\\")
    .replace(/\//g, "\\");

export async function entries(host: ImportHost, path: string): Promise<Entry[]> {
  const listed = await host.list(path).catch(() => null);
  return Array.isArray(listed) ? listed : [];
}

export async function exists(host: ImportHost, folder: string, name: string): Promise<boolean> {
  return (await entries(host, folder)).some((e) => e.name.toLowerCase() === name.toLowerCase());
}

export async function readJson(host: ImportHost, path: string, largest = 64 << 20): Promise<unknown> {
  const text = await host.readText(path, largest).catch(() => null);
  if (text == null) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export type Row = { get(column: string): Cell | undefined; text(column: string): string | undefined; int(column: string): number | undefined; blob(column: string): string | undefined };

export function rowsOf(result: Rows | undefined): Row[] {
  if (!result) return [];
  const index = new Map(result.columns.map((name, i) => [name, i] as const));
  return result.rows.map((cells) => {
    const get = (column: string) => {
      const i = index.get(column);
      return i === undefined ? undefined : cells[i];
    };
    return {
      get,
      text: (column) => {
        const value = get(column);
        return typeof value === "string" ? value : typeof value === "number" ? String(value) : undefined;
      },
      int: (column) => {
        const value = get(column);
        return typeof value === "number" ? value : typeof value === "string" && /^-?\d+$/.test(value) ? Number(value) : undefined;
      },
      blob: (column) => {
        const value = get(column);
        return value && typeof value === "object" ? value.blob : undefined;
      },
    };
  });
}
