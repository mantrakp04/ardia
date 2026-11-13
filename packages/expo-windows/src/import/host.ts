import type { Credential, WrittenCounts } from "./model";

export type Entry = { name: string; dir: boolean; size: number; modified: number };
export type Cell = number | string | null | { blob: string };
export type Query = { sql: string; args?: (string | number)[]; limit?: number };
export type Rows = { columns: string[]; rows: Cell[][]; error?: string };
export type SnapshotFailure = "missing" | "inUse" | "unreadable" | "noTemp" | "refused" | "cancelled" | "closed";
export type Secrets = { undecryptable: number; appBound: number; failure?: SnapshotFailure };
export type CookieRead = Secrets & { count: number; dropped: number; skipped?: number; token?: string };
export type AutofillRead = Secrets & { addresses: number; cards: number; lockedCards: number; token?: string };
export type FirefoxLoginRead = Secrets & { items: Credential[]; error?: { code: "locked" | "unsupported" | "unreadable" | "notFound"; message: string } };
export type Answer = { results: Rows[] } | { failure: SnapshotFailure };

export type ImportHost = {
  localAppData: string;
  roamingAppData: string;
  list(path: string): Promise<Entry[] | null | { denied: true }>;
  readText(path: string, largest: number): Promise<string | null>;
  readBase64(path: string, largest: number): Promise<string | null>;
  readTextWithin(folder: string, path: string, largest: number): Promise<string | null>;
  readBase64Within(folder: string, path: string, largest: number): Promise<string | null>;
  query(path: string, queries: Query[]): Promise<Answer>;
  openSnapshot(path: string): Promise<{ id: string } | { failure: SnapshotFailure }>;
  querySnapshot(id: string, queries: Query[]): Promise<Answer>;
  closeSnapshot(id: string): void;
  unlock(browserId: string, localState: string): Promise<{ unlocked: boolean; appBound: boolean }>;
  logins(browserId: string, files: string[]): Promise<Secrets & { items: Credential[] }>;
  cookies(browserId: string, file: string): Promise<CookieRead>;
  firefoxLogins(profile: string): Promise<FirefoxLoginRead>;
  firefoxCookies(file: string): Promise<CookieRead>;
  autofill(browserId: string, file: string, joinToken: string): Promise<AutofillRead>;
  writeImported(token: string, profile: string, kinds: ("cookies" | "autofill")[]): Promise<WrittenCounts>;
  discard(token: string): void;
  forget(): void;
};

export function pathFromFileUrl(picked: string): string {
  if (!picked.startsWith("file:")) return picked;
  const decoded = decodeURIComponent(picked);
  const local = /^file:\/\/\/([A-Za-z]:.*)$/.exec(decoded);
  if (local) return local[1]!.replace(/\//g, "\\");
  const network = /^file:\/\/([^/].*)$/.exec(decoded);
  if (network) return `\\\\${network[1]!.replace(/\//g, "\\")}`;
  return decoded.replace(/^file:\/*/, "").replace(/\//g, "\\");
}

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
