const OFF_THE_RECORD = "@";

const openWindows = new Map<string, number>();
const heldReleases = new Set<string>();

export const isPrivateName = (name: string) => name.includes(OFF_THE_RECORD);

const parentOf = (name: string) => name.slice(name.indexOf(OFF_THE_RECORD) + 1);

const siblingsOpen = (name: string) => [...openWindows.keys()].some((open) => open !== name && parentOf(open) === parentOf(name));

export function privateWindowShown(name: string): () => void {
  if (!isPrivateName(name)) return () => {};
  openWindows.set(name, (openWindows.get(name) ?? 0) + 1);
  return () => {
    const left = (openWindows.get(name) ?? 0) - 1;
    if (left > 0) openWindows.set(name, left);
    else openWindows.delete(name);
  };
}

export async function releaseProfile(name: string, send: (name: string) => Promise<unknown>): Promise<void> {
  if (!isPrivateName(name)) {
    await send(name);
    return;
  }
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
