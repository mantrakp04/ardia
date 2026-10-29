import type { Credential } from "../../../packages/import/src/index.ts";

export const IMPORT_HANDLE_PREFIX = "ardia-import-handle:";
export const IMPORT_HANDLE_LIFETIME_MS = 10 * 60_000;

type Writer = (token: string, profile: string) => Promise<{ added: number }>;
type Batch = { token: string; write: Writer; added?: Promise<number> };
type Handle = { batch: Batch; index: number; issued: number };

const handles = new Map<string, Handle>();

const randomId = () => globalThis.crypto.randomUUID();

function forgetExpired(now: number) {
  for (const [handle, entry] of handles) {
    if (now - entry.issued >= IMPORT_HANDLE_LIFETIME_MS) handles.delete(handle);
  }
}

export function issueImportHandles(token: string, entries: { url: string; username: string }[], write: Writer, now = Date.now()): Credential[] {
  forgetExpired(now);
  const batch: Batch = { token, write };
  return entries.map((entry, index) => {
    const handle = `${IMPORT_HANDLE_PREFIX}${randomId()}`;
    handles.set(handle, { batch, index, issued: now });
    return { url: entry.url, username: entry.username, password: handle };
  });
}

export function isImportHandle(value: unknown): value is string {
  return typeof value === "string" && handles.has(value);
}

export async function claimImportHandle(handle: string, profile: string): Promise<boolean> {
  const entry = handles.get(handle);
  if (!entry) return false;
  handles.delete(handle);
  entry.batch.added ??= entry.batch.write(entry.batch.token, profile).then((written) => written.added, () => 0);
  return entry.index < (await entry.batch.added);
}
