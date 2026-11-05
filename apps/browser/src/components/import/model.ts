import type {
  BrowserProfile,
  BrowserSource,
  DiaTabsResult,
  ImportedExtension,
  ImportKind,
  ImportResult,
  SpaceSummary,
} from "../../state/import/apply";
import { IMPORT_KINDS } from "../../state/import/flow";

export type { BrowserProfile, BrowserSource, DiaTabsResult, ImportedExtension, ImportKind, ImportResult, SpaceSummary };

export const APP = "Ardia";

const KIND_LOOK: Record<ImportKind, { title: string; icon: string }> = {
  bookmarks: { title: "Bookmarks", icon: "bookmark" },
  history: { title: "History", icon: "clock" },
  passwords: { title: "Passwords", icon: "key" },
  cookies: { title: "Cookies (stay signed in)", icon: "person.badge.key" },
  autofill: { title: "Addresses and cards", icon: "creditcard" },
  tabs: { title: "Tabs", icon: "square.on.square" },
  spaces: { title: "Spaces", icon: "square.stack" },
  pinnedTabs: { title: "Pinned tabs", icon: "pin" },
  favorites: { title: "Favorites", icon: "star" },
};
export const KINDS: { kind: ImportKind; title: string; icon: string }[] = IMPORT_KINDS.map((kind) => ({ kind, ...KIND_LOOK[kind] }));
export const kindTitle = (k: ImportKind) => KIND_LOOK[k].title;

export const DIA_NOT_SHARED = "Custom tab names, colours, spaces and folders stay in Dia: its AppleScript doesn't share them.";
