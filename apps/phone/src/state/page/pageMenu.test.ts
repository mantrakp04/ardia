import assert from "node:assert/strict";
import test from "node:test";
import { blockersToast, menuModel, menuTitle, nightShadeIsOn, searchQuery, translationUrl, zoomPercent, type MenuInput } from "./pageMenu.ts";
import {
  backLayer,
  clampReaderStep,
  confirmAnswer,
  findCount,
  findHasMatches,
  pressHeading,
  pressLinkUrl,
  pressMenuGroups,
  readerBodySize,
  readerSource,
  readerTheme,
  readingMinutes,
  requestPlan,
  type BackState,
  type Request,
} from "./pagePrompts.ts";

const input = (extra: Partial<MenuInput> = {}): MenuInput => ({
  url: "https://example.com/a",
  hasPage: true,
  canGoBack: true,
  canGoForward: false,
  isLoading: false,
  pageZoom: 1,
  zoomLevels: [0.5, 0.75, 1, 1.25, 1.5, 2],
  isDesktopSite: false,
  nightShade: "disabled",
  systemDark: false,
  blockersEnabled: true,
  blockedRequests: 0,
  ...extra,
});

test("the menu follows the page: navigation, reload or stop, zoom limits, blocked count", () => {
  const model = menuModel(input({ blockedRequests: 12345, pageZoom: 2 }));
  assert.equal(model.back, true);
  assert.equal(model.forward, false);
  assert.equal(model.reload, "reload");
  assert.equal(model.zoomIn, false);
  assert.equal(model.zoomOut, true);
  assert.equal(model.zoomPercent, "200%");
  assert.equal(model.blockedCount, "12,345");
  assert.equal(menuModel(input({ isLoading: true })).reload, "stop");
  assert.equal(menuModel(input({ blockersEnabled: false, blockedRequests: 9 })).blockedCount, null);
  assert.equal(menuModel(input({ blockedRequests: 0 })).blockedCount, null);
});

test("a non-web page disables what needs a web page", () => {
  const model = menuModel(input({ url: "about:blank" }));
  assert.equal(model.isWebPage, false);
  assert.equal(model.tiles, false);
  assert.equal(model.find, false);
  assert.equal(model.translate, false);
  assert.equal(model.reloadEnabled, false);
  assert.equal(model.zoomIn, false);
  assert.equal(menuModel(input({ url: "about:blank", isLoading: true })).reloadEnabled, true);
});

test("without a live page the page rows are hidden", () => {
  assert.equal(menuModel(input({ hasPage: false })).pageRows, false);
  assert.equal(menuModel(input({ hasPage: false })).translate, false);
});

test("night shade, zoom text, translation and blocker toasts read as on Android", () => {
  assert.equal(nightShadeIsOn("automatic", true), true);
  assert.equal(nightShadeIsOn("automatic", false), false);
  assert.equal(nightShadeIsOn("always", false), true);
  assert.equal(zoomPercent(1.25), "125%");
  assert.equal(
    translationUrl("https://example.com/a?b=1", "de-DE"),
    "https://translate.google.com/translate?sl=auto&tl=de&u=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1",
  );
  assert.equal(translationUrl("https://x.y/", ""), "https://translate.google.com/translate?sl=auto&tl=en&u=https%3A%2F%2Fx.y%2F");
  assert.equal(blockersToast(false, "x.com"), "Blockers disabled for x.com");
});

test("the menu title is the search query on a search page, else the title or host", () => {
  assert.equal(searchQuery("https://www.google.com/search?q=sea+otters&hl=en"), "sea otters");
  assert.equal(searchQuery("https://duckduckgo.com/?t=h&q=caf%C3%A9"), "café");
  assert.equal(searchQuery("https://example.com/?q=nope"), null);
  assert.equal(searchQuery("https://www.google.com/maps"), null);
  assert.equal(menuTitle("Otters", "https://a.b/", "a.b", "otters"), "otters");
  assert.equal(menuTitle("  ", "https://a.b/", "a.b", null), "a.b");
});

test("find shows a position, no matches only once the search is done, nothing for a stale query", () => {
  assert.deepEqual(findCount({ query: "ott", activeIndex: 2, total: 9, isDone: true }, "ott"), { kind: "match", label: "3 of 9" });
  assert.equal(findCount({ query: "ott", activeIndex: -1, total: 0, isDone: false }, "ott"), null);
  assert.deepEqual(findCount({ query: "ott", activeIndex: -1, total: 0, isDone: true }, "ott"), { kind: "none", label: "No matches" });
  assert.equal(findCount({ query: "ot", activeIndex: 0, total: 4, isDone: true }, "ott"), null);
  assert.equal(findCount(null, ""), null);
  assert.equal(findHasMatches({ query: "ott", activeIndex: 0, total: 1, isDone: true }, "ott"), true);
});

const request = (kind: Request["kind"], extra: Record<string, unknown> = {}) =>
  ({ id: "r1", host: "a.b", title: "a.b says", message: "Hi", kind, ...extra }) as unknown as Request;

test("each page request maps to its dialog or a direct answer", () => {
  const alert = requestPlan(request("alert", { text: "Hi" }));
  assert.equal(alert.kind === "dialog" && alert.dialog.cancel, null);
  const prompt = requestPlan(request("prompt", { text: "Name?", defaultText: "Ada" }));
  assert.equal(prompt.kind === "dialog" && prompt.dialog.field, "text");
  assert.equal(prompt.kind === "dialog" && prompt.dialog.defaultText, "Ada");
  const auth = requestPlan(request("httpAuthentication", { realm: "x" }));
  assert.equal(auth.kind === "dialog" && auth.dialog.confirm, "Sign In");
  const permission = requestPlan(request("permission", { permission: "camera" }));
  assert.equal(permission.kind === "dialog" && permission.dialog.cancel, "Don’t Allow");
  assert.deepEqual(requestPlan(request("fileChooser", { acceptTypes: [], allowsMultiple: false, prefersCapture: false })), {
    kind: "answer",
    answer: { type: "pickFiles" },
  });
  assert.deepEqual(confirmAnswer(request("prompt"), "Bo", "", ""), { type: "text", text: "Bo" });
  assert.deepEqual(confirmAnswer(request("httpAuthentication"), "", "u", "p"), { type: "credential", user: "u", password: "p" });
  assert.deepEqual(confirmAnswer(request("openExternal"), "", "", ""), { type: "accept" });
});

test("the long-press menu matches Compose for links and images", () => {
  assert.deepEqual(pressMenuGroups({ kind: "link", url: "https://a/", text: "A" }), [
    ["openInNewTab", "openInBackground"],
    ["copyLink", "share", "download"],
  ]);
  const linked = { kind: "image" as const, url: "https://a/i.png", linkUrl: "https://a/" };
  assert.deepEqual(pressMenuGroups(linked).at(-1), ["saveImage"]);
  assert.equal(pressLinkUrl(linked), "https://a/");
  assert.deepEqual(pressMenuGroups({ kind: "image", url: "https://a/i.png", linkUrl: null })[1], ["copyLink", "share", "saveImage"]);
  assert.equal(pressHeading({ kind: "link", url: "https://a/", text: null }), "https://a/");
});

const back = (extra: Partial<BackState>): BackState => ({
  isFullscreen: false,
  hasRequest: false,
  isSearching: false,
  hasPressMenu: false,
  isReading: false,
  isMenuOpen: false,
  isFinding: false,
  canGoBack: false,
  hasTab: true,
  ...extra,
});

test("system back closes the topmost layer first", () => {
  assert.equal(backLayer(back({ isSearching: true, isFinding: true, canGoBack: true })), "tray");
  assert.equal(backLayer(back({ isReading: true, isMenuOpen: true })), "reader");
  assert.equal(backLayer(back({ isMenuOpen: true, isFinding: true })), "menu");
  assert.equal(backLayer(back({ isFinding: true, canGoBack: true })), "find");
  assert.equal(backLayer(back({ canGoBack: true })), "pageHistory");
  assert.equal(backLayer(back({})), "deck");
  assert.equal(backLayer(back({ hasTab: false })), null);
  assert.equal(backLayer(back({ isFullscreen: true, isSearching: true })), "fullscreen");
  assert.equal(backLayer(back({ hasRequest: true, isMenuOpen: true, canGoBack: true })), "request");
});

test("reader sizes, themes and source line", () => {
  assert.equal(readerBodySize(2), 19);
  assert.equal(clampReaderStep(99), 6);
  assert.equal(clampReaderStep(-3), 0);
  assert.equal(readerTheme(null, true), "dark");
  assert.equal(readerTheme("sepia", true), "sepia");
  assert.equal(readingMinutes(10), 1);
  assert.equal(readingMinutes(2300), 10);
  assert.equal(readerSource("Site", null), "Site");
  assert.equal(readerSource("", "Ada"), "Ada");
  assert.equal(readerSource("", null), null);
});
