export const KEYS = {
  visitorId: "ac:id",
  window: "ac:window",
  session: "ac:session",
  deviceModel: "ac:model",
  flags: "ac:flags",
  flagsReported: "ac:flag_called",
  replaySeq: "ac:replay_seq",
  macLinkVisit: "ac:mac_link_visit",
  nonMacVisit: "ac:non_mac_visit",
  releaseNotesView: "ac:release-notes-view",
} as const;

type Store = "local" | "session";
const storage = (store: Store) => (store === "local" ? localStorage : sessionStorage);

export function read(key: string, store: Store = "local"): string | null {
  try {
    return storage(store).getItem(key);
  } catch {
    return null;
  }
}

export function write(key: string, value: string, store: Store = "local") {
  try {
    storage(store).setItem(key, value);
  } catch {}
}

export function readJSON<T>(key: string, store: Store = "local"): T | null {
  try {
    return JSON.parse(read(key, store) ?? "null") as T | null;
  } catch {
    return null;
  }
}

export function firstThisSession(key: string): boolean {
  const seen = read(key, "session") === "1";
  write(key, "1", "session");
  return !seen;
}
