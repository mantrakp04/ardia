export type Unread = { kind: "count"; label: string } | { kind: "dot" };

export const UNREAD_DOT: Unread = { kind: "dot" };

const COUNT = String.raw`(\d{1,3}(?:,\d{3})+|\d{1,6})(\+?)`;
const LEADING_COUNT = new RegExp(String.raw`^[(\[]${COUNT}[)\]]\s*\S`);
const LABEL_COUNT = new RegExp(String.raw`^([^\d()\[\]]{1,32}?)\s\(${COUNT}\)$`);
const PHRASE_COUNT = new RegExp(String.raw`(?:^|[\s(\[])${COUNT}\s+(?:unread|new (?:messages?|notifications?|e-?mails?|mails?|chats?))\b`, "i");
const LEADING_BULLET = /^•\s+[^\s•\d]/u;
const LEADING_STAR = /^\*\s+[^\s*\d]/u;
const SEGMENTS = /\s+[-–—|·•:/]\s+/u;
const MAX_LABEL_WORDS = 3;
const UNREAD_LABEL_WORDS = new Set([
  "inbox",
  "mail",
  "email",
  "messages",
  "message",
  "chat",
  "chats",
  "notifications",
  "notification",
  "mentions",
  "activity",
  "conversations",
  "dms",
  "unread",
  "updates",
  "alerts",
]);
const STAR_MEANS_UNREAD = ["slack.com"];

const looksLikeYear = (digits: string) => digits.length === 4 && +digits >= 1900 && +digits <= 2100;

function countOf(raw: string, plus: string): Unread | null {
  const digits = raw.replace(/,/g, "");
  if (looksLikeYear(digits)) return null;
  const n = Number(digits);
  if (!Number.isFinite(n) || n <= 0) return null;
  return unreadCount(n, !!plus);
}

export function unreadCount(n: number, more = false): Unread | null {
  if (!Number.isFinite(n) || n < 1) return null;
  const whole = Math.floor(n);
  return { kind: "count", label: whole > 99 ? "99+" : more ? `${whole}+` : String(whole) };
}

export function hostOfOrigin(origin: string): string {
  return origin.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/:\d+$/, "").toLowerCase();
}

const onSite = (host: string, sites: readonly string[]) => sites.some((site) => host === site || host.endsWith(`.${site}`));

const brandOf = (host: string) => {
  const labels = host.split(".").filter(Boolean);
  return labels.length >= 2 ? labels[labels.length - 2]! : (labels[0] ?? "");
};

function labelMeansUnread(label: string, host: string): boolean {
  const words = label.trim().toLowerCase().split(/\s+/);
  if (words.length > MAX_LABEL_WORDS) return false;
  const brand = brandOf(host);
  return words.some((w) => UNREAD_LABEL_WORDS.has(w) || (brand.length > 2 && w === brand));
}

export function unreadInTitle(raw: string, host = ""): Unread | null {
  const title = raw.trim();
  if (!title) return null;
  const leading = LEADING_COUNT.exec(title);
  if (leading) return countOf(leading[1]!, leading[2]!);
  const phrase = PHRASE_COUNT.exec(title);
  if (phrase) return countOf(phrase[1]!, phrase[2]!);
  const labelled = LABEL_COUNT.exec(title.split(SEGMENTS)[0]!);
  if (labelled && labelMeansUnread(labelled[1]!, host)) return countOf(labelled[2]!, labelled[3]!);
  if (LEADING_BULLET.test(title)) return UNREAD_DOT;
  return LEADING_STAR.test(title) && onSite(host, STAR_MEANS_UNREAD) ? UNREAD_DOT : null;
}

export function originOf(url: string): string {
  const m = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]*)/i.exec(url);
  return m ? m[1]!.toLowerCase() : "";
}

const BADGE_TOKEN = /(?:^|[-_.])(?:unread|badge|badged|notif|notification|notifications|alert|dot|count|mention|mentions)(?=[-_.\d]|$)/i;

const fileNameOf = (url: string) => {
  const path = url.replace(/[?#].*$/, "").replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "");
  return path.slice(path.lastIndexOf("/") + 1);
};

export const faviconIsBadgeNamed = (url: string) => !url.startsWith("data:") && BADGE_TOKEN.test(fileNameOf(url));

export const faviconIsOrdinary = (url: string) => !!url && !url.startsWith("data:") && !faviconIsBadgeNamed(url);

export function faviconLooksBadged(home: string, now: string): boolean {
  return !!home && now !== home && faviconIsBadgeNamed(now);
}
