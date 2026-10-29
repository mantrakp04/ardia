import type { MenuItem } from "../../platform/menus";
import type { ChoiceItem } from "../app/menuChoice";
import { menuShortcut } from "../commands/commandShortcuts";
import { bookmarkRoots, folderChildren, ROOT_TITLES } from "../bookmarks/bookmarks";
import type { BrowserState } from "../browser/store";
import { bookmarkProfileId, windowTitle } from "../browser/model";
import { groupLabel } from "../pins/tabGrouping";
import { groupPath } from "../groups/groups";

export { menuSections as sections } from "../app/menuSections";

export type Choice = Extract<MenuItem, { id: string }>;

export type Destination =
  | { kind: "profile"; profileId: string | null }
  | { kind: "window"; windowId: string | null }
  | { kind: "group"; groupId: string }
  | { kind: "folder"; parentId: string | undefined }
  | { kind: "newFolder" };

export type BookmarkFolderChoice = Extract<Destination, { kind: "folder" | "newFolder" }>;

type DestinationItem = ChoiceItem<Destination>;

export const sep = { separator: true } as const;

export const hintWhen = (on: boolean, command: string, s?: BrowserState) => (on ? menuShortcut(command, s) : {});

const sameModifiers = (a: readonly string[] = [], b: readonly string[] = []) => a.length === b.length && a.every((m) => b.includes(m));

export function withAlternate(primary: Choice, alternate: Choice, commands: readonly [string, string] | null, s?: BrowserState): MenuItem[] {
  const keys = commands ? [menuShortcut(commands[0], s), menuShortcut(commands[1], s)] : [];
  const [a, b] = keys;
  if (a?.key && b?.key && a.key === b.key && sameModifiers(b.modifiers, [...(a.modifiers ?? []), "option"])) {
    return [{ ...primary, ...a }, { ...alternate, ...b, alternate: true }];
  }
  return [
    { ...primary, modifiers: [] },
    { ...alternate, modifiers: ["option"], alternate: true },
  ];
}

export function profileItems(s: BrowserState, isCurrent: (profileId: string) => boolean): DestinationItem[] {
  return [
    ...s.profileOrder.map((id) => ({ value: { kind: "profile" as const, profileId: id }, title: s.profiles[id]!.name, checked: isCurrent(id), enabled: !isCurrent(id) })),
    sep,
    { value: { kind: "profile", profileId: null }, title: "New Profile…" },
  ];
}

export function windowItems(s: BrowserState, windowId: string): DestinationItem[] {
  const others = s.windowOrder.filter((id) => id !== windowId && s.windows[id]!.kind !== "private" && s.windows[id]!.kind !== "small");
  return [
    ...others.map((id) => ({ value: { kind: "window" as const, windowId: id }, title: windowTitle(s, id) })),
    ...(others.length ? [sep] : []),
    { value: { kind: "window", windowId: null }, title: "New Window" },
  ];
}

export function groupItems(s: BrowserState, windowId: string, exclude: string | undefined): DestinationItem[] {
  const w = s.windows[windowId];
  const byTitle = (a: { title: string }, z: { title: string }) => (a.title < z.title ? -1 : a.title > z.title ? 1 : 0);
  const listed = Object.values(s.groups)
    .filter((g) => g.windowId === windowId && g.profileId === w?.profileId && g.id !== exclude)
    .map((g) => ({
      pinned: g.pinned,
      item: { value: { kind: "group" as const, groupId: g.id }, title: groupPath(s.groups, g.id).map((id) => groupLabel(s, s.groups[id]!)).join(" › ") },
    }));
  const pinned = listed.filter((g) => g.pinned).map((g) => g.item).sort(byTitle);
  const rest = listed.filter((g) => !g.pinned).map((g) => g.item).sort(byTitle);
  if (!pinned.length) return rest;
  return [{ id: "pinnedGroupsHeader", title: "Pinned", enabled: false }, ...pinned, ...(rest.length ? [sep, ...rest] : [])];
}

export function bookmarkFolderItems(s: BrowserState, windowId: string): DestinationItem[] {
  const roots = bookmarkRoots(s, bookmarkProfileId(s, s.windows[windowId]));
  const folders = roots ? [...folderChildren(s.bookmarks, roots.bar), ...folderChildren(s.bookmarks, roots.other)].filter((n) => n.kind === "folder") : [];
  const folder = (parentId: string | undefined, title: string): DestinationItem => ({ value: { kind: "folder", parentId }, title });
  return [
    folder(undefined, ROOT_TITLES.bar),
    ...(roots ? [folder(roots.other, ROOT_TITLES.other)] : []),
    ...folders.map((f) => folder(f.id, f.title)),
    sep,
    { value: { kind: "newFolder" }, title: "New Folder…" },
  ];
}
