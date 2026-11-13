import { engineAvailable, hostCall } from "./host";

const OFF_THE_RECORD = "@";
const CLOSED_WINDOW_RELEASE_MS = 1000;

type Later = (run: () => void) => unknown;

const openWindows = new Map<string, number>();
const heldReleases = new Set<string>();
const releasedNames = new Set<string>();
let holds = 0;

export const isPrivateName = (name: string) => name.includes(OFF_THE_RECORD);

const parentOf = (name: string) => name.slice(name.indexOf(OFF_THE_RECORD) + 1);

const siblingsOpen = (name: string) => [...openWindows.keys()].some((open) => open !== name && parentOf(open) === parentOf(name));

const releaseInHost = (name: string) => hostCall("profile.release", { profile: name });

const afterClose: Later = (run) => setTimeout(run, CLOSED_WINDOW_RELEASE_MS);

export function privateWindowShown(name: string, later: Later = afterClose): () => void {
  if (!isPrivateName(name)) return () => {};
  openWindows.set(name, (openWindows.get(name) ?? 0) + 1);
  return () => {
    const left = (openWindows.get(name) ?? 0) - 1;
    if (left > 0) {
      openWindows.set(name, left);
      return;
    }
    openWindows.delete(name);
    later(() => {
      if (!openWindows.has(name)) void releaseProfile(name, releaseInHost).catch(() => {});
    });
  };
}

export async function releaseProfile(name: string, send: (name: string) => Promise<unknown>): Promise<void> {
  if (!isPrivateName(name)) {
    await send(name);
    return;
  }
  if (releasedNames.has(name)) return;
  releasedNames.add(name);
  openWindows.delete(name);
  if (siblingsOpen(name)) {
    heldReleases.add(name);
    return;
  }
  const parent = parentOf(name);
  const due = [...heldReleases].filter((held) => parentOf(held) === parent);
  for (const held of due) heldReleases.delete(held);
  for (const released of [...due, name]) await send(released);
}

export function holdPrivateSession(name: string, windowId: string): () => void {
  if (!isPrivateName(name) || !windowId || !engineAvailable()) return () => {};
  holds += 1;
  const key = `private-window:${windowId}:${holds}:${name}`;
  const held = hostCall("tab.create", { key, url: "", profile: name }, windowId).then(
    () => true,
    () => false,
  );
  return () => void held.then((made) => (made ? hostCall("tab.close", { key }).catch(() => {}) : undefined));
}
