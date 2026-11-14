import { isSyncableUrl } from "../tabs/tabModels.ts";

export type NightShadeMode = "disabled" | "automatic" | "always";

export type MenuInput = {
  url: string;
  hasPage: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  pageZoom: number;
  zoomLevels: readonly number[];
  isDesktopSite: boolean;
  nightShade: NightShadeMode;
  systemDark: boolean;
  blockersEnabled: boolean;
  blockedRequests: number;
  isDefaultBrowser?: boolean;
};

export type MenuModel = {
  isWebPage: boolean;
  back: boolean;
  forward: boolean;
  reload: "reload" | "stop";
  reloadEnabled: boolean;
  tiles: boolean;
  find: boolean;
  pageRows: boolean;
  translate: boolean;
  nightShadeOn: boolean;
  zoomPercent: string;
  zoomOut: boolean;
  zoomIn: boolean;
  desktopSite: boolean;
  blockersEnabled: boolean;
  blockedCount: string | null;
  offersDefaultBrowser: boolean;
};

export const zoomPercent = (zoom: number) => `${Math.round(zoom * 100)}%`;

export function nightShadeIsOn(mode: NightShadeMode, systemDark: boolean): boolean {
  if (mode === "always") return true;
  if (mode === "automatic") return systemDark;
  return false;
}

const grouped = (count: number) => String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

export function menuModel(input: MenuInput): MenuModel {
  const isWebPage = isSyncableUrl(input.url);
  const levels = input.zoomLevels.length ? input.zoomLevels : [1];
  const web = isWebPage && input.hasPage;
  return {
    isWebPage,
    back: input.canGoBack,
    forward: input.canGoForward,
    reload: input.isLoading ? "stop" : "reload",
    reloadEnabled: input.isLoading || isWebPage,
    tiles: isWebPage,
    find: isWebPage,
    pageRows: input.hasPage,
    translate: web,
    nightShadeOn: nightShadeIsOn(input.nightShade, input.systemDark),
    zoomPercent: zoomPercent(input.pageZoom),
    zoomOut: web && input.pageZoom > levels[0]! + 0.001,
    zoomIn: web && input.pageZoom < levels[levels.length - 1]! - 0.001,
    desktopSite: input.isDesktopSite,
    blockersEnabled: input.blockersEnabled,
    blockedCount: input.blockersEnabled && input.blockedRequests > 0 ? grouped(input.blockedRequests) : null,
    offersDefaultBrowser: !input.isDefaultBrowser,
  };
}

export function menuTitle(title: string, url: string, host: string | null, searchQuery: string | null): string {
  if (searchQuery) return searchQuery;
  return title.trim() || host || url;
}

export function translationUrl(url: string, language: string): string {
  const target = language.slice(0, 2) || "en";
  return `https://translate.google.com/translate?sl=auto&tl=${encodeURIComponent(target)}&u=${encodeURIComponent(url)}`;
}

export const blockersToast = (enabled: boolean, host: string) => (enabled ? `Blockers enabled for ${host}` : `Blockers disabled for ${host}`);

const SEARCH_HOSTS = [
  "google.com",
  "bing.com",
  "duckduckgo.com",
  "ecosia.org",
  "brave.com",
  "kagi.com",
  "startpage.com",
  "yahoo.com",
  "perplexity.ai",
  "baidu.com",
  "yandex.com",
  "chatgpt.com",
];

const QUERY_KEYS = ["q", "query", "p", "text", "wd", "search_query"];

function decode(text: string): string {
  try {
    return decodeURIComponent(text.replace(/\+/g, " "));
  } catch {
    return text;
  }
}

export function searchQuery(url: string): string | null {
  const match = /^https?:\/\/(?:[^@/?#]*@)?([^:/?#]+)[^?#]*\?([^#]*)/i.exec(url);
  if (!match) return null;
  const host = match[1]!.toLowerCase();
  if (!SEARCH_HOSTS.some((known) => host === known || host.endsWith(`.${known}`))) return null;
  const items = match[2]!.split("&").map((part) => {
    const at = part.indexOf("=");
    return at < 0 ? [decode(part), null] : [decode(part.slice(0, at)), decode(part.slice(at + 1))];
  });
  for (const key of QUERY_KEYS) {
    const value = items.find(([name]) => name === key)?.[1]?.trim();
    if (value) return value;
  }
  return null;
}
