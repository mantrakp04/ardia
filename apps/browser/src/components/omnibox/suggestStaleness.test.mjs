import assert from "node:assert/strict";
import { test } from "node:test";
import { mount } from "../../test-hooks.mjs";

globalThis.__DEV__ = false;
const { useBrowser } = await import("../../state/browser/store.ts");
const { useSuggestions } = await import("./useSuggestions.ts");
const { scopeFor, keywordScope } = await import("../../state/omnibox/scopes.ts");
const { currentBarActions } = await import("../../state/omnibox/barActions.ts");

const S = () => useBrowser.getState();
const DAY = 86_400_000;
const entry = (url, title, ago = DAY) => ({ url, title, favicon: null, visits: 3, lastVisit: Date.now() - ago, visitTimes: [Date.now() - ago] });

function setup() {
  S().hydrate({});
  const w = S().createWindow({ url: "https://start.example/" });
  const work = S().createProfile({ name: "Work" });
  useBrowser.setState((s) => ({
    history: {
      ...s.history,
      "": { list: [entry("https://zebra.example/one", "Zebra one"), entry("https://zebra.example/two", "Zebra two", 2 * DAY)], floor: -Infinity, ready: true },
      [work]: { list: [entry("https://zebra.work/", "Zebra at work")], floor: -Infinity, ready: true },
    },
  }));
  return { w, work };
}

const bar = (w, profileId = "default") =>
  mount(({ text, profileId }) => useSuggestions({ text, active: true, windowId: w, profileId, scope: null }), { props: { text: "z", profileId } });
const pages = (result) => result.items.filter((x) => x.kind === "page" && x.title).map((x) => `${x.url}${x.tabId ? " [tab]" : ""}${x.bookmarked ? " [bm]" : ""} ${x.title}`);
const type = (h, text, profileId = "default") => pages(h.rerender({ text, profileId }));

test("mid-typing: a history entry deleted and history cleared are gone on screen and on the next key", () => {
  const { w } = setup();
  const h = bar(w);
  assert.deepEqual(type(h, "ze"), ["https://zebra.example/one Zebra one", "https://zebra.example/two Zebra two"]);
  S().removeHistory("default", ["https://zebra.example/one"]);
  assert.deepEqual(pages(h.value), ["https://zebra.example/two Zebra two"], "the result on screen updates");
  assert.deepEqual(type(h, "zeb"), ["https://zebra.example/two Zebra two"], "and the next key narrows without it");
  assert.deepEqual(type(h, "ze"), ["https://zebra.example/two Zebra two"], "backspace too");
  S().clearHistory("default");
  assert.deepEqual(pages(h.value), [], "cleared");
  assert.deepEqual(type(h, "zebr"), []);
  h.unmount();
});

test("mid-typing: a tab opened, retitled and closed; a bookmark added and removed; a profile switch", () => {
  const { w, work } = setup();
  const h = bar(w);
  type(h, "z");
  const t = S().newTab(w, { url: "https://zoo.example/", background: true });
  S().updateTab(t, { title: "Zoo" });
  assert.ok(type(h, "zo").includes("https://zoo.example/ [tab] Zoo"), "a tab opened while typing");
  S().updateTab(t, { title: "Zoo renamed" });
  assert.ok(pages(h.value).includes("https://zoo.example/ [tab] Zoo renamed"), "retitled: on screen");
  assert.ok(type(h, "zoo").includes("https://zoo.example/ [tab] Zoo renamed"), "retitled: next key");
  S().closeTab(t);
  assert.deepEqual(pages(h.value).filter((p) => p.includes("zoo")), [], "closed: on screen");
  assert.deepEqual(type(h, "zoo ").filter((p) => p.includes("zoo")), [], "closed: next key");

  type(h, "zeb");
  const id = S().addBookmark({ profileId: "default", url: "https://zebra.example/two", title: "Zebra two" });
  assert.ok(pages(h.value).includes("https://zebra.example/two [bm] Zebra two"), "bookmarked: on screen");
  assert.ok(type(h, "zebr").includes("https://zebra.example/two [bm] Zebra two"), "bookmarked: next key");
  S().removeBookmark(id);
  assert.ok(pages(h.value).includes("https://zebra.example/two Zebra two"), "unbookmarked: on screen");
  assert.ok(type(h, "zebra").includes("https://zebra.example/two Zebra two"), "unbookmarked: next key");

  assert.deepEqual(type(h, "zebra", work), ["https://zebra.work/ Zebra at work"], "another profile");
  assert.ok(type(h, "zebra", "default").includes("https://zebra.example/two Zebra two"), "and back");
  h.unmount();
});

test("the bar's actions and known hosts follow the store: bookmark, mute, pin, profile name, a new host", () => {
  const { w, work } = setup();
  const titles = () => currentBarActions(w).map((a) => a.title);
  const tab = S().windows[w].tabIds[0];
  assert.ok(titles().includes("Bookmark This Page"));
  S().toggleBookmark("default", { url: "https://start.example/", title: "Start", favicon: null });
  assert.ok(titles().includes("Remove Bookmark"), "bookmarked");
  S().toggleBookmark("default", { url: "https://start.example/", title: "Start", favicon: null });
  assert.ok(titles().includes("Bookmark This Page"), "unbookmarked");
  S().updateTab(tab, { muted: true });
  assert.ok(titles().includes("Unmute Tab"), "muted");
  S().setSiteMuted(tab, true);
  assert.ok(titles().includes("Unmute Site"), "site muted");
  S().togglePin(tab);
  assert.ok(titles().includes("Unpin from Top Apps"), "pinned");
  S().updateProfile(work, { name: "Office" });
  assert.ok(titles().includes("Switch to Office"), "a renamed profile");

  assert.equal(scopeFor("newhost.example", w), null);
  const t = S().newTab(w, { url: "https://newhost.example/page", background: true });
  assert.equal(scopeFor("newhost.example", w)?.host, "newhost.example", "a host opened in a tab");
  S().closeTab(t);
  assert.equal(scopeFor("newhost.example", w), null, "gone with its tab");
});

test("Space enters a site's search only after its bare host or an engine keyword", () => {
  const { w } = setup();
  assert.equal(keywordScope("youtube.com", w)?.name, "YouTube");
  assert.equal(keywordScope("www.youtube.com/", w)?.name, "YouTube");
  assert.equal(keywordScope("zebra.example", w)?.host, "zebra.example", "a host from history");
  for (const text of ["youtube", "github.com/foo", "github.com?x=1", "youtube.com:443", "me@github.com", "nothere.example"])
    assert.equal(keywordScope(text, w), null, text);
});
