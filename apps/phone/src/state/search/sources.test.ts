import assert from "node:assert/strict";
import test from "node:test";
import { mobileSetSources, mobileSuggest } from "@ardia/core/src/mobile.ts";
import type { BrowserTab } from "../tabs/tabModels.ts";
import { buildSources, recentSearches } from "./sources.ts";

const tab = (id: string, url: string, title: string, isPrivate = false): BrowserTab => ({
  id,
  url,
  title,
  created: 1,
  lastActive: 1,
  archivedAt: null,
  position: 0,
  profileSyncId: null,
  faviconUrl: null,
  themeColorHex: null,
  snapshotFileName: null,
  origin: "typed",
  receivedKey: null,
  receivedFromDevice: null,
  isPrivate,
});

test("open tabs and history reach the omnibox, private tabs do not", () => {
  const sources = buildSources(
    [tab("T1", "https://www.otterhaven.org/", "Otter Haven"), tab("P1", "https://secretotters.example/", "Secret Otters", true)],
    [{ url: "https://otterfacts.example/", title: "Otter Facts", favicon: null, visits: 3, lastVisit: Date.now() }],
  );
  assert.deepEqual(sources.tabs.map((t) => t.id), ["T1"]);
  mobileSetSources(sources);
  const items = mobileSuggest("otter", { limit: 8, now: Date.now() }).items;
  const pages = items.filter((item) => item.kind === "page");
  assert.ok(pages.some((item) => item.kind === "page" && item.tabId === "T1"), "the open tab is offered as a switch");
  assert.ok(pages.some((item) => item.kind === "page" && item.url === "https://otterfacts.example/"), "history is offered");
  assert.ok(!pages.some((item) => item.kind === "page" && item.url.includes("secretotters")), "private tabs never show");
});

test("an empty tray offers the three most recent distinct searches, newest first", () => {
  const row = (url: string, lastVisit: number) => ({ url, title: "", favicon: null, visits: 1, lastVisit });
  const rows = [
    row("https://www.google.com/search?q=otters", 5),
    row("https://example.com/", 9),
    row("https://duckduckgo.com/?q=Lisbon+trams", 8),
    row("https://www.google.com/search?q=OTTERS&hl=en", 7),
    row("https://www.bing.com/search?q=tapas", 3),
    row("https://www.google.com/search?q=sea+otters", 1),
  ];
  assert.deepEqual(recentSearches(rows), ["Lisbon trams", "OTTERS", "tapas"]);
  assert.deepEqual(recentSearches([row("https://example.com/?q=nope", 1)]), []);
});
