import { create } from "zustand";
import { expectFocus } from "../../lib/focusClaims";
import { useBrowser } from "../../store/browser";

export type LibrarySection = "spaces" | "archive" | "downloads" | "media";

type LibraryState = { open: Record<string, LibrarySection> };

export const LIBRARY_FOCUS = "library";

export const useLibrary = create<LibraryState>()(() => ({ open: {} }));

export const librarySection = (windowId: string): LibrarySection | undefined => useLibrary.getState().open[windowId];

export function archivedFor<T extends { kind?: string; tab: { profileId: string } }>(closed: readonly T[], profileId: string | undefined): T[] {
  if (!profileId) return [];
  return closed.filter((c) => c.kind === "tab" && c.tab.profileId === profileId);
}

export function cleanedIn<T extends { tab: { profileId: string } }>(cleaned: readonly T[], profileId: string | undefined): T[] {
  return profileId ? cleaned.filter((c) => c.tab.profileId === profileId) : [];
}

export function libraryAllowed(windowId: string): boolean {
  const w = useBrowser.getState().windows[windowId];
  return !!w && !w.incognito;
}

export function openLibrary(windowId: string, section: LibrarySection = librarySection(windowId) ?? "spaces") {
  if (!libraryAllowed(windowId)) return;
  expectFocus(windowId, LIBRARY_FOCUS);
  useLibrary.setState((s) => ({ open: { ...s.open, [windowId]: section } }));
}

export function closeLibrary(windowId: string) {
  if (!librarySection(windowId)) return;
  useLibrary.setState((s) => {
    const { [windowId]: _, ...open } = s.open;
    return { open };
  });
}

export function toggleLibrary(windowId: string) {
  if (librarySection(windowId)) closeLibrary(windowId);
  else openLibrary(windowId);
}

export type DayGroup<T> = { title: string; items: T[] };

export function byDay<T>(items: readonly T[], at: (item: T) => number, now = new Date()): DayGroup<T>[] {
  const dayNumber = (d: Date) => Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
  const today = dayNumber(now);
  const label = (t: number) => {
    const days = today - dayNumber(new Date(t));
    if (days <= 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days} days ago`;
    if (days < 14) return "Last week";
    return new Date(t).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  };
  const groups: DayGroup<T>[] = [];
  for (const item of [...items].sort((a, b) => at(b) - at(a))) {
    const title = label(at(item));
    const last = groups[groups.length - 1];
    if (last?.title === title) last.items.push(item);
    else groups.push({ title, items: [item] });
  }
  return groups;
}
