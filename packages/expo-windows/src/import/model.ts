export type ImportKind = "bookmarks" | "history" | "tabs" | "passwords" | "cookies" | "autofill" | "spaces" | "pinnedTabs" | "favorites";

export const KIND_ORDER: ImportKind[] = ["bookmarks", "history", "tabs", "passwords", "cookies", "autofill", "spaces", "pinnedTabs", "favorites"];

export type Family = "chromium" | "firefox" | "safari" | "arc";

export type BookmarkNode = {
  type: "folder" | "url";
  title: string;
  url?: string;
  dateAdded?: number;
  children?: BookmarkNode[];
  role?: string;
};

export type HistoryEntry = { url: string; title: string; visits: number; lastVisit: number; typedCount?: number };

export type ImportedTab = { url: string; title: string; pinned: boolean; groupId?: string; windowIndex: number; active: boolean; lastActive?: number };

export type TabGroup = { id: string; title: string; color: string; collapsed: boolean };

export type OpenTabs = { tabs: ImportedTab[]; groups: TabGroup[] };

export type Credential = {
  url: string;
  username: string;
  password: string;
  realm?: string;
  title?: string;
  note?: string;
  otpAuth?: string;
  created?: number;
  lastUsed?: number;
  timesUsed?: number;
};

export type Favicon = { page: string; icon: string; png: string };

export type WarningCode = "empty" | "undecryptable" | "skipped" | "locked" | "unreadable" | "unsupported" | "notRunning";

export type Warning = { kind: ImportKind; code: WarningCode; message: string };

export type Profile = {
  id: string;
  name: string;
  path: string;
  email?: string;
  avatarPath?: string;
  color?: string;
  isDefault: boolean;
  available: ImportKind[];
  tabsNeedKey: boolean;
};

export type Source = {
  id: string;
  name: string;
  family: Family;
  requiresExport: boolean;
  needsKeychain: boolean;
  needsFullDiskAccess: boolean;
  profiles: Profile[];
  asksAppForTabs: boolean;
};

export type Result = {
  browserId: string;
  profileId: string;
  profile?: { name: string; color?: string; avatarPath?: string };
  bookmarks?: BookmarkNode;
  history: HistoryEntry[];
  historyCount: number;
  tabs: ImportedTab[];
  tabGroups: TabGroup[];
  credentials: Credential[];
  cookieCount: number;
  addressCount: number;
  cardCount: number;
  vaultToken?: string;
  spaces: never[];
  favorites: ImportedTab[];
  favicons: Favicon[];
  failed: ImportKind[];
  warnings: Warning[];
};

export type Progress = { kind: ImportKind; phase: "start" | "progress" | "end"; processed: number; total?: number };

export type Options = { historyLimit?: number; historySince?: number; chunkSize?: number; streamHistory?: boolean };

export type Observer = {
  progress(progress: Progress): void;
  history?(entries: HistoryEntry[]): void;
  cancelled(): boolean;
};

export type FailureCode = "cancelled" | "notFound" | "unreadable" | "unsupported" | "locked";

export class ImportFailure extends Error {
  readonly code: FailureCode;

  constructor(code: FailureCode, message: string) {
    super(message);
    this.code = code;
  }
}

export const warningCode = (code: FailureCode): WarningCode =>
  code === "notFound" ? "empty" : code === "unsupported" ? "unsupported" : code === "locked" ? "locked" : "unreadable";

export const linkCount = (node: BookmarkNode | undefined): number =>
  !node ? 0 : node.type === "url" ? 1 : (node.children ?? []).reduce((n, child) => n + linkCount(child), 0);

export const folder = (title: string, children: BookmarkNode[], extra: Partial<BookmarkNode> = {}): BookmarkNode => ({ type: "folder", title, children, ...extra });

export const link = (title: string, url: string, dateAdded?: number): BookmarkNode =>
  dateAdded === undefined ? { type: "url", title, url } : { type: "url", title, url, dateAdded };

const WEBKIT_EPOCH_OFFSET_MICROS = 11_644_473_600_000_000;

export const fromWebKit = (micros: number | string | undefined | null): number | undefined => {
  const value = typeof micros === "string" ? Number(micros) : micros;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return (value - WEBKIT_EPOCH_OFFSET_MICROS) / 1000;
};

export const toWebKit = (ms: number) => Math.round(ms * 1000) + WEBKIT_EPOCH_OFFSET_MICROS;

export const fromUnixMicros = (micros: number | undefined | null): number | undefined =>
  typeof micros === "number" && micros > 0 ? micros / 1000 : undefined;

export const isWebUrl = (url: string) => /^https?:/i.test(url);

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function checkCancelled(observer: Observer) {
  if (observer.cancelled()) throw new ImportFailure("cancelled", "Import cancelled");
}

export function hexColor(skColor: number): string {
  const v = skColor >>> 0;
  const hex = (n: number) => n.toString(16).toUpperCase().padStart(2, "0");
  return `#${hex((v >>> 16) & 0xff)}${hex((v >>> 8) & 0xff)}${hex(v & 0xff)}`;
}
