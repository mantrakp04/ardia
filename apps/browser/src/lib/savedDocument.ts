export type SavedObject = Record<string, unknown>;
export type Migrations = Readonly<Record<number, (doc: SavedObject) => unknown>>;

export const unchanged = (doc: SavedObject): SavedObject => doc;

const isSavedObject = (value: unknown): value is SavedObject => typeof value === "object" && value !== null && !Array.isArray(value);
const owns = (object: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(object, key);

export function upgraded(doc: unknown, version: number, migrations: Migrations = {}, field = "version"): SavedObject | null {
  if (!isSavedObject(doc)) return null;
  let at = 0;
  if (owns(doc, field)) {
    const saved = doc[field];
    if (typeof saved !== "number" || !Number.isSafeInteger(saved) || saved < 0) return null;
    at = saved;
  }
  if (at > version) return null;
  let current = doc;
  while (at < version) {
    if (!owns(migrations, at)) return null;
    const next = migrations[at]!(current);
    if (!isSavedObject(next)) return null;
    at += 1;
    current = { ...next, [field]: at };
  }
  return current;
}

export function parseSaved(json: string | null | undefined, version: number, migrations: Migrations = {}, field = "version"): SavedObject | null {
  if (!json) return null;
  try {
    return upgraded(JSON.parse(json), version, migrations, field);
  } catch {
    return null;
  }
}

export const versionedJson = (data: object, version: number, field = "version", space?: number): string =>
  JSON.stringify({ ...data, [field]: version }, null, space);
