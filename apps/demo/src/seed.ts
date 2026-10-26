import type { HydrateData } from "../../browser/src/state/browser/store";
import type { BrowserWindow, HistoryEntry, Profile, Tab } from "../../browser/src/state/browser/types";
import { faviconFor, PAGES } from "./pages";

export const WINDOW_ID = "w_demo";
export const PERSONAL: Profile = { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 };
export const WORK: Profile = { id: "p_work", name: "Work", color: "blue", icon: null, createdAt: 0 };
export const ACTIVE_TABS = { [PERSONAL.id]: "t_browser", [WORK.id]: "t_vite" };

type Page = { url: string; title: string };
type FaviconOf = (url: string) => string | null;

const DAY = 86_400_000;

function tab(favicon: FaviconOf, now: number, id: string, profileId: string, page: Page, pinned = false, ageMinutes = 0): Tab {
  const at = now - ageMinutes * 60_000;
  return {
    id,
    windowId: WINDOW_ID,
    profileId,
    url: page.url,
    title: page.title,
    favicon: favicon(page.url),
    pinned,
    muted: false,
    zoom: 1,
    customTitle: null,
    customIcon: null,
    pinnedUrl: pinned ? page.url : null,
    navigation: null,
    openerId: null,
    createdAt: at,
    lastActiveAt: at,
  };
}

export function seedTabs(favicon: FaviconOf = faviconFor, now = Date.now()): Tab[] {
  const make = (...a: [string, string, Page, boolean?, number?]) => tab(favicon, now, ...a);
  return [
    make("t_pin_wikipedia", PERSONAL.id, PAGES.wikipediaHome, true, 300),
    make("t_pin_mdn", PERSONAL.id, PAGES.mdn, true, 290),
    make("t_pin_github", PERSONAL.id, PAGES.github, true, 280),
    make("t_browser", PERSONAL.id, PAGES.wikipedia, false, 1),
    make("t_hn", PERSONAL.id, PAGES.hackerNews, false, 12),
    make("t_react", PERSONAL.id, PAGES.react, false, 25),
    make("t_xkcd", PERSONAL.id, PAGES.xkcd, false, 40),
    make("t_rust", PERSONAL.id, PAGES.rust, false, 55),
    make("t_caniuse", PERSONAL.id, PAGES.caniuse, false, 70),
    make("t_pin_whatwg", WORK.id, PAGES.whatwg, true, 400),
    make("t_vite", WORK.id, PAGES.vite, false, 30),
    make("t_gutenberg", WORK.id, PAGES.gutenberg, false, 45),
  ];
}

export function seedWindow(tabs: Tab[], frame: BrowserWindow["frame"] = null, now = Date.now()): BrowserWindow {
  return {
    id: WINDOW_ID,
    profileId: PERSONAL.id,
    incognito: false,
    tabIds: tabs.map((t) => t.id),
    activeTabIds: ACTIVE_TABS,
    sidebarOpen: true,
    frame,
    createdAt: now,
  };
}

export const HISTORY_PAGES: Page[] = [
  ...Object.values(PAGES),
  { url: "https://en.wikipedia.org/wiki/Hypertext", title: "Hypertext - Wikipedia" },
  { url: "https://en.wikipedia.org/wiki/World_Wide_Web", title: "World Wide Web - Wikipedia" },
  { url: "https://en.wikipedia.org/wiki/Tim_Berners-Lee", title: "Tim Berners-Lee - Wikipedia" },
  { url: "https://react.dev/learn", title: "Quick Start – React" },
  { url: "https://developer.mozilla.org/en-US/docs/Web/CSS/backdrop-filter", title: "backdrop-filter - CSS | MDN" },
  { url: "https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe", title: "<iframe>: The Inline Frame element - HTML | MDN" },
  { url: "https://xkcd.com/927/", title: "xkcd: Standards" },
  { url: "https://vite.dev/config/", title: "Configuring Vite | Vite" },
  { url: "https://caniuse.com/css-backdrop-filter", title: "CSS Backdrop Filter | Can I use..." },
];

export function seedHistory(pages: Page[], favicon: FaviconOf = faviconFor, now = Date.now()): HistoryEntry[] {
  return pages.map((page, i) => {
    const visits = Math.max(1, 14 - i);
    const lastVisit = now - (i + 1) * 3_600_000;
    return { url: page.url, title: page.title, favicon: favicon(page.url), visits, lastVisit, visitTimes: Array.from({ length: visits }, (_, v) => lastVisit - v * DAY) };
  });
}

export function demoSession(): HydrateData {
  const tabs = seedTabs();
  const window = seedWindow(tabs);
  return {
    profiles: { [PERSONAL.id]: PERSONAL, [WORK.id]: WORK },
    profileOrder: [PERSONAL.id, WORK.id],
    windows: { [WINDOW_ID]: window },
    windowOrder: [WINDOW_ID],
    focusedWindowId: WINDOW_ID,
    tabs: Object.fromEntries(tabs.map((t) => [t.id, t])),
    history: { [PERSONAL.id]: seedHistory(HISTORY_PAGES), [WORK.id]: seedHistory(HISTORY_PAGES.slice(8)) },
  };
}
