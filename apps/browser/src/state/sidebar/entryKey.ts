const PREFIX = { tab: "t:", group: "g:", split: "s:", live: "lf:", tileFolder: "tf:" } as const;

export type EntryKind = keyof typeof PREFIX;

const KINDS = Object.keys(PREFIX) as EntryKind[];

export const entryKey = (kind: EntryKind, id: string): string => PREFIX[kind] + id;

export function entryId(key: string, kind: EntryKind): string | null {
  return key.startsWith(PREFIX[kind]) ? key.slice(PREFIX[kind].length) : null;
}

export function parseEntry(key: string): { kind: EntryKind; id: string } {
  for (const kind of KINDS) if (key.startsWith(PREFIX[kind])) return { kind, id: key.slice(PREFIX[kind].length) };
  throw new Error(`Not a sidebar entry key: ${key}`);
}
