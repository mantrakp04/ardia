import type {
  BookmarkNode,
  BookmarkRole,
  BrowserFamily,
  BrowserProfile,
  BrowserSource,
  Credential,
  ImportedFavicon,
  ImportedHistoryEntry,
  ImportedTab,
  ImportedTabGroup,
  ImportKind,
  ImportOptions,
  ImportProgress,
  ImportResult,
  ImportWarning,
  WrittenCounts,
} from "@ardia/import";

export type { BookmarkNode, BookmarkRole, Credential, ImportedTab, ImportKind, WrittenCounts };

export type Family = BrowserFamily;
export type HistoryEntry = ImportedHistoryEntry;
export type TabGroup = ImportedTabGroup;
export type Favicon = ImportedFavicon;
export type Warning = Extract<ImportWarning, { kind: ImportKind }>;
export type WarningCode = Warning["code"];
export type Profile = BrowserProfile;
export type Source = BrowserSource;
export type Result = ImportResult;
export type Progress = ImportProgress;
export type OpenTabs = { tabs: ImportedTab[]; groups: TabGroup[] };

export const KIND_ORDER: ImportKind[] = ["bookmarks", "history", "tabs", "passwords", "cookies", "autofill", "spaces", "pinnedTabs", "favorites"];

export type Options = Pick<ImportOptions, "historyLimit" | "historySince" | "chunkSize" | "spaceIds"> & { streamHistory?: boolean; historyPage?: number };

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
