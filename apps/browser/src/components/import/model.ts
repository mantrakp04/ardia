import type {
  BrowserProfile,
  BrowserSource,
  DiaTabsResult,
  ImportedExtension,
  ImportKind,
  ImportResult,
  SpaceSummary,
} from "../../state/import/apply";

export type { BrowserProfile, BrowserSource, DiaTabsResult, ImportedExtension, ImportKind, ImportResult, SpaceSummary };

export const APP = "Ardia";

export type Step = "loading" | "choose" | "profiles" | "safari" | "access" | "unlock" | "progress" | "done";
export type Status = "pending" | "active" | "done" | "failed";

export const KINDS: { kind: ImportKind; title: string; icon: string }[] = [
  { kind: "bookmarks", title: "Bookmarks", icon: "bookmark" },
  { kind: "history", title: "History", icon: "clock" },
  { kind: "passwords", title: "Passwords", icon: "key" },
  { kind: "cookies", title: "Cookies (stay signed in)", icon: "person.badge.key" },
  { kind: "autofill", title: "Addresses and cards", icon: "creditcard" },
  { kind: "tabs", title: "Tabs", icon: "square.on.square" },
  { kind: "spaces", title: "Spaces", icon: "square.stack" },
  { kind: "pinnedTabs", title: "Pinned tabs", icon: "pin" },
  { kind: "favorites", title: "Favorites", icon: "star" },
];
export const kindTitle = (k: ImportKind) => KINDS.find((x) => x.kind === k)?.title ?? k;

export const ENCRYPTED: ImportKind[] = ["passwords", "cookies", "autofill"];

export const DIA_NOT_SHARED = "Custom tab names, colours, spaces and folders stay in Dia: its AppleScript doesn't share them.";
