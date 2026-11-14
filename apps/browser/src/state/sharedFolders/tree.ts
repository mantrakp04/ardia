export type BaseLink = { kind: "link"; key: string; file: string; name: string; url: string; id?: string | null };
export type BaseDir = { kind: "dir"; key: string; file: string; name: string; children: BaseEntry[] };
export type BaseEntry = BaseLink | BaseDir;

export type LocalLink = { kind: "link"; key: string; name: string; url: string };
export type LocalDir = { kind: "dir"; key: string; name: string; children: LocalEntry[] };
export type LocalEntry = LocalLink | LocalDir;

export type RemoteLink = { kind: "link"; file: string; url: string; id: string | null };
export type RemoteHeld = { kind: "held"; file: string; waiting: boolean };
export type RemoteDir = { kind: "dir"; file: string; level: RemoteLevel };
export type RemoteEntry = RemoteLink | RemoteHeld | RemoteDir;
export type RemoteLevel = { entries: RemoteEntry[]; manifest: string[] | null; manifestPending: boolean };

export type Dropped = { kind: "link"; file: string; url: string } | { kind: "dir"; file: string; known: BaseEntry[] };

export type TargetLink = { kind: "link"; key: string | null; file: string | null; name: string; url: string; renamed: boolean; write: boolean; expect: string | null; id: string | null; fileId: string | null; heldName: string | null };
export type TargetDir = { kind: "dir"; key: string | null; file: string | null; name: string; renamed: boolean; level: TargetLevel };
export type TargetEntry = TargetLink | TargetDir;
export type TargetLevel = { entries: TargetEntry[]; dropped: Dropped[]; remote: RemoteLevel | null };

export const LINK_EXTENSION = ".webloc";
export const MANIFEST = ".ardia-folder.json";
const MANIFEST_VERSION = 1;
const MAX_NAME_BYTES = 200;

const utf8Bytes = (c: string) => {
  const code = c.codePointAt(0)!;
  return code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
};

function capBytes(text: string, limit: number): string {
  let used = 0;
  let out = "";
  for (const c of text) {
    used += utf8Bytes(c);
    if (used > limit) break;
    out += c;
  }
  return out;
}

export const EMPTY_REMOTE: RemoteLevel = { entries: [], manifest: null, manifestPending: false };

export const isLinkFile = (file: string) => file.toLowerCase().endsWith(LINK_EXTENSION);

export const nameOfFile = (file: string, kind: "link" | "dir") => (kind === "link" && isLinkFile(file) ? file.slice(0, -LINK_EXTENSION.length) : file);

export function cleanName(name: string, fallback: string): string {
  const cleaned = name
    .replace(/[/:]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .trim();
  return capBytes(cleaned || fallback, MAX_NAME_BYTES).trim() || fallback;
}

export const fileNameFor = (name: string, kind: "link" | "dir") => (kind === "link" ? `${cleanName(name, "Link")}${LINK_EXTENSION}` : cleanName(name, "Folder"));

export function uniqueFileName(name: string, kind: "link" | "dir", taken: Set<string>): string {
  const first = fileNameFor(name, kind);
  const stem = nameOfFile(first, kind);
  let file = first;
  for (let n = 2; taken.has(file.toLowerCase()); n++) file = kind === "link" ? `${stem} ${n}${LINK_EXTENSION}` : `${stem} ${n}`;
  taken.add(file.toLowerCase());
  return file;
}

export const manifestText = (order: string[]) => `${JSON.stringify({ version: MANIFEST_VERSION, order })}\n`;

export function manifestIsNewer(text: string | null): boolean {
  try {
    const version = (JSON.parse(text ?? "null") as { version?: unknown } | null)?.version;
    return typeof version === "number" && version > MANIFEST_VERSION;
  } catch {
    return false;
  }
}

export function parseManifest(text: string | null): string[] | null {
  if (!text) return null;
  try {
    const doc: unknown = JSON.parse(text);
    if (!doc || typeof doc !== "object") return null;
    const { version, order } = doc as { version?: unknown; order?: unknown };
    if (version !== MANIFEST_VERSION) return null;
    return Array.isArray(order) ? order.filter((f): f is string => typeof f === "string") : null;
  } catch {
    return null;
  }
}

export function remoteOrder(level: RemoteLevel): { listed: string[]; rest: string[] } {
  const present = new Set(level.entries.map((e) => e.file));
  const listed = (level.manifest ?? []).filter((f, i, all) => present.has(f) && all.indexOf(f) === i);
  const inList = new Set(listed);
  const rest = level.entries.map((e) => e.file).filter((f) => !inList.has(f));
  rest.sort((a, z) => a.localeCompare(z, undefined, { numeric: true, sensitivity: "base" }));
  return { listed, rest };
}
