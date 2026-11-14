export type TabOrigin = "typed" | "search" | "link" | "sync" | "share" | "sent";

export const TAB_ORIGINS: readonly TabOrigin[] = ["typed", "search", "link", "sync", "share", "sent"];

export type BrowserTab = {
  id: string;
  url: string;
  title: string;
  created: number;
  lastActive: number;
  archivedAt: number | null;
  position: number;
  profileSyncId: string | null;
  faviconUrl: string | null;
  themeColorHex: string | null;
  snapshotFileName: string | null;
  origin: TabOrigin;
  receivedKey: string | null;
  receivedFromDevice: string | null;
  isPrivate: boolean;
};

export type TabPatch = Partial<Pick<BrowserTab, "url" | "title" | "faviconUrl" | "themeColorHex" | "snapshotFileName">>;

export type AutoArchiveInterval = "oneHour" | "fourHours" | "twelveHours" | "day" | "threeDays" | "week" | "never";

const HOUR = 3_600_000;

export const AUTO_ARCHIVE_INTERVALS: Record<AutoArchiveInterval, number | null> = {
  oneHour: HOUR,
  fourHours: 4 * HOUR,
  twelveHours: 12 * HOUR,
  day: 24 * HOUR,
  threeDays: 72 * HOUR,
  week: 168 * HOUR,
  never: null,
};

export const STANDARD_AUTO_ARCHIVE: AutoArchiveInterval = "day";

export const isAutoArchiveInterval = (raw: unknown): raw is AutoArchiveInterval =>
  typeof raw === "string" && Object.prototype.hasOwnProperty.call(AUTO_ARCHIVE_INTERVALS, raw);

export function autoArchiveTitle(interval: AutoArchiveInterval): string {
  const duration = AUTO_ARCHIVE_INTERVALS[interval];
  if (duration === null) return "Never";
  const plural = (count: number, unit: string) => (count === 1 ? `1 ${unit}` : `${count} ${unit}s`);
  return `After ${duration >= 24 * HOUR ? plural(duration / (24 * HOUR), "day") : plural(duration / HOUR, "hour")}`;
}

export function isAutoArchiveDue(lastActive: number, now: number, interval: AutoArchiveInterval, isBeingViewed: boolean): boolean {
  const duration = AUTO_ARCHIVE_INTERVALS[interval];
  if (duration === null || isBeingViewed || lastActive > now) return false;
  return now - lastActive >= duration;
}

export const isSyncableUrl = (url: string) => /^https?:\/\//i.test(url);

export const POSITION_STEP = 1024;

export function positionBetween(lower: number | undefined, upper: number | undefined): number | null {
  if (lower === undefined && upper === undefined) return 0;
  if (upper === undefined) return lower! + POSITION_STEP;
  if (lower === undefined) return upper - POSITION_STEP;
  const middle = (lower + upper) / 2;
  return middle > lower && middle < upper && upper - lower > 1e-6 ? middle : null;
}

export function recencyOrder(tabs: readonly BrowserTab[], selectedId: string | null): BrowserTab[] {
  return [...tabs].sort((lhs, rhs) => {
    if (lhs.id === rhs.id) return 0;
    if (lhs.id === selectedId) return 1;
    if (rhs.id === selectedId) return -1;
    if (lhs.lastActive !== rhs.lastActive) return lhs.lastActive - rhs.lastActive;
    return lhs.position - rhs.position;
  });
}

export type PageLook = { url: string | null; title: string; faviconUrl: string | null; themeColor: string | null };

export function pageStatePatch(tab: BrowserTab, page: PageLook, keepsAddress: boolean): TabPatch | null {
  const patch: TabPatch = {};
  const url = keepsAddress && page.url && isSyncableUrl(page.url) ? page.url : null;
  const title = page.title.trim() ? page.title : null;
  if (url && url !== tab.url) patch.url = url;
  if (title && title !== tab.title) patch.title = title;
  if (!tab.isPrivate && page.faviconUrl && /^https?:\/\//i.test(page.faviconUrl) && page.faviconUrl !== tab.faviconUrl) patch.faviconUrl = page.faviconUrl;
  if (page.themeColor && page.themeColor !== tab.themeColorHex) patch.themeColorHex = page.themeColor;
  return Object.keys(patch).length ? patch : null;
}

export const coverIsCapturable = (finishedLoading: boolean | undefined, covered: boolean) => finishedLoading === true && !covered;
