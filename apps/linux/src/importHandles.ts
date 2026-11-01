import type { Credential } from "../../../packages/import/src/index.ts";

export const IMPORT_HANDLE_PREFIX = "ardia-import-handle:";
export const IMPORT_HANDLE_LIFETIME_MS = 10 * 60_000;

type Writer = (token: string, profile: string) => Promise<{ added: number }>;
type Batch = { token: string; write: Writer; added?: Promise<number> };
type Handle = { batch: Batch; index: number; issued: number };

const handles = new Map<string, Handle>();
let sweep: ReturnType<typeof setTimeout> | undefined;

const randomId = () => globalThis.crypto.randomUUID();

function forgetExpired(now: number) {
  for (const [handle, entry] of handles) {
    if (now - entry.issued >= IMPORT_HANDLE_LIFETIME_MS) handles.delete(handle);
  }
  clearTimeout(sweep);
  sweep = undefined;
  if (!handles.size) return;
  const oldest = Math.min(...[...handles.values()].map((entry) => entry.issued));
  sweep = setTimeout(() => forgetExpired(Date.now()), Math.max(0, oldest + IMPORT_HANDLE_LIFETIME_MS - now));
}

export function issueImportHandles(token: string, entries: { url: string; username: string }[], write: Writer, now = Date.now()): Credential[] {
  const batch: Batch = { token, write };
  const credentials = entries.map((entry, index) => {
    const handle = `${IMPORT_HANDLE_PREFIX}${randomId()}`;
    handles.set(handle, { batch, index, issued: now });
    return { url: entry.url, username: entry.username, password: handle };
  });
  forgetExpired(now);
  return credentials;
}

export function isImportHandle(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(IMPORT_HANDLE_PREFIX);
}

export async function claimImportHandle(handle: string, profile: string): Promise<boolean> {
  const entry = handles.get(handle);
  if (!entry) return false;
  handles.delete(handle);
  if (!handles.size) forgetExpired(Date.now());
  entry.batch.added ??= entry.batch.write(entry.batch.token, profile).then((written) => written.added, () => 0);
  return entry.index < (await entry.batch.added);
}
