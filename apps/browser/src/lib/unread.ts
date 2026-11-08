export type Unread = { kind: "count"; label: string } | { kind: "dot" };

export const UNREAD_DOT: Unread = { kind: "dot" };

const COUNT = String.raw`(\d{1,3}(?:,\d{3})+|\d{1,6})(\+?)`;
const LEADING_COUNT = new RegExp(String.raw`^[(\[]${COUNT}[)\]]\s*\S`);
const LABEL_COUNT = new RegExp(String.raw`^([^\d()\[\]]{1,32}?)\s\(${COUNT}\)$`);
const PHRASE_COUNT = new RegExp(String.raw`(?:^|[\s(\[])${COUNT}\s+(?:unread|new (?:messages?|notifications?|e-?mails?|mails?|chats?))\b`, "i");
const LEADING_DOT = /^[•●⬤*!]\s+[^\s•●⬤*!\d]/u;
const SEGMENTS = /\s+[-–—|·•:/]\s+/u;
const MAX_LABEL_WORDS = 3;

const looksLikeYear = (digits: string) => digits.length === 4 && +digits >= 1900 && +digits <= 2100;

function countOf(digits: string, plus: string): Unread | null {
  const n = Number(digits.replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return unreadCount(n, !!plus);
}

export function unreadCount(n: number, more = false): Unread | null {
  if (!Number.isFinite(n) || n < 1) return null;
  const whole = Math.floor(n);
  return { kind: "count", label: whole > 99 ? "99+" : more ? `${whole}+` : String(whole) };
}

export function unreadInTitle(raw: string): Unread | null {
  const title = raw.trim();
  if (!title) return null;
  const leading = LEADING_COUNT.exec(title);
  if (leading && !looksLikeYear(leading[1]!)) return countOf(leading[1]!, leading[2]!);
  const phrase = PHRASE_COUNT.exec(title);
  if (phrase) return countOf(phrase[1]!, phrase[2]!);
  const labelled = LABEL_COUNT.exec(title.split(SEGMENTS)[0]!);
  if (labelled && labelled[1]!.trim().split(/\s+/).length <= MAX_LABEL_WORDS && !looksLikeYear(labelled[2]!)) return countOf(labelled[2]!, labelled[3]!);
  return LEADING_DOT.test(title) ? UNREAD_DOT : null;
}

export function originOf(url: string): string {
  const m = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]*)/i.exec(url);
  return m ? m[1]!.toLowerCase() : "";
}

const BADGED_ICON = /unread|badge|notif|alert|attention|indicator|[-_./]dot[-_./]|[-_./]new[-_./]|count/i;

export function faviconLooksBadged(home: string, now: string): boolean {
  if (!home || !now || home === now) return false;
  if (now.startsWith("data:")) return !home.startsWith("data:");
  return BADGED_ICON.test(now) && !BADGED_ICON.test(home);
}
