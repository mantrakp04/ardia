import { hostOf, urlForDisplay } from "./omnibox.ts";
import type { SuggestionSource } from "./suggestion.ts";

export function displayUrl(url: string): string {
  return urlForDisplay(url).replace(/\/$/, "");
}

export const pageKey = (url: string) => url.replace(/#.*$/, "").replace(/\/$/, "");

export type PageText = {
  url: string;
  key: string;
  shown: string;
  shownLower: string;
  titleLower: string;
  titleWords: string;
  shownWords?: string;
  shownBlank?: boolean;
  host?: string;
  origin?: string | null;
  hostLower?: string;
};

export const pageTexts = new WeakMap<object, PageText>();

const logVisitsOf: number[] = [];
export const logVisits = (visits: number) => (visits >= 0 && visits < 1024 && (visits | 0) === visits ? (logVisitsOf[visits] ??= Math.log2(1 + visits) * 8) : Math.log2(1 + visits) * 8);

const NOT_WORD = /[^a-z0-9]+/g;
const PLAIN_WORDS = /^[a-z0-9]+(?: [a-z0-9]+)*$/;
const wordsOf = (lower: string) => (PLAIN_WORDS.test(lower) ? ` ${lower}` : ` ${lower}`.replace(NOT_WORD, " "));
export const shownWordsOf = (t: PageText) => (t.shownWords ??= wordsOf(t.shownLower));

export function pageText(row: { url: string; title: string }): PageText {
  let text = pageTexts.get(row);
  if (!text) {
    const shown = displayUrl(row.url);
    const shownLower = shown.toLowerCase();
    const titleLower = row.title.toLowerCase();
    text = { url: row.url, key: pageKey(row.url), shown, shownLower, titleLower, titleWords: wordsOf(titleLower) };
    pageTexts.set(row, text);
  }
  return text;
}

const renamedTexts = new WeakMap<object, { listed: PageText | undefined; text: PageText }>();

export function tabPageText(row: Pick<SuggestionSource["tabs"][number], "url" | "title" | "customTitle">, listed?: PageText): PageText {
  const text = pageText(row);
  if (!row.customTitle) return text;
  const kept = renamedTexts.get(row);
  if (kept && kept.listed === listed) return kept.text;
  const titles = [row.customTitle.toLowerCase(), text.titleLower];
  if (listed && listed.titleLower !== text.titleLower) titles.push(listed.titleLower);
  const titleLower = titles.join("\n");
  const renamed = { ...(listed ?? text), titleLower, titleWords: wordsOf(titleLower) };
  renamedTexts.set(row, { listed, text: renamed });
  return renamed;
}

export const hostOfPage = (t: PageText) => (t.host ??= hostOf(t.url));
export const hostPart = (shown: string) => /^[^/?#]*/.exec(shown)![0];
export const hostLowerOfPage = (t: PageText) => (t.hostLower ??= hostPart(t.shownLower));
export const originOfPage = (t: PageText) => (t.origin === undefined ? (t.origin = /^https?:\/\/[^/?#]+/i.exec(t.url)?.[0] ?? null) : t.origin);
