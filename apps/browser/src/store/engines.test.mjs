import assert from "node:assert/strict";
import { test } from "node:test";
import { engineForUrl, engineMark, ruleFor, siteOf, tabEngine, typedNavigationEngine, visitRecorder } from "./engines.ts";
import { makeTab, snapshotTab } from "./model.ts";

const tab = (id, patch = {}) => ({ id, url: "", navigation: null, openerId: null, ...patch });
const state = (tabs, settings = {}) => ({
  tabs: Object.fromEntries(tabs.map((t) => [t.id, t])),
  settings: { pageEngine: "chromium", websiteEngines: {}, ...settings },
});

test("a site is its scheme, host and port, and nothing else", () => {
  assert.equal(siteOf("https://www.Netflix.com/watch/1?x=2#y"), "https://www.netflix.com");
  assert.equal(siteOf("http://localhost:8080/a"), "http://localhost:8080");
  assert.equal(siteOf("https://example.com:443/"), "https://example.com");
  assert.equal(siteOf("ardia://settings"), null);
  assert.equal(siteOf("not a url"), null);
});

test("rules match the exact site, never its subdomains", () => {
  const s = state([], { websiteEngines: { "https://netflix.com": "webkit" } });
  assert.equal(ruleFor(s, "https://netflix.com/browse"), "webkit");
  assert.equal(ruleFor(s, "https://www.netflix.com/browse"), undefined);
  assert.equal(ruleFor(s, "http://netflix.com/"), undefined);
  assert.equal(engineForUrl(s, "https://www.netflix.com/"), "chromium");
  assert.equal(engineForUrl({ settings: { ...s.settings, pageEngine: "webkit" } }, "https://example.com/"), "webkit");
});

test("a tab keeps its engine, else follows its adoption, its opener, then rules", () => {
  const rules = { websiteEngines: { "https://www.netflix.com": "webkit" } };
  const s = state(
    [
      tab("fixed", { engine: "chromium", url: "https://www.netflix.com/" }),
      tab("popup", { adoptId: "webkit:3" }),
      tab("chrome", { adoptId: "ardiacore:9", url: "https://www.netflix.com/" }),
      tab("opener", { engine: "webkit", url: "https://www.netflix.com/" }),
      tab("link", { openerId: "opener", url: "https://example.com/" }),
      tab("typed", { url: "https://www.netflix.com/" }),
      tab("copy", { adoptId: "clone:opener" }),
    ],
    rules,
  );
  assert.equal(tabEngine(s, "fixed"), "chromium");
  assert.equal(tabEngine(s, "popup"), "webkit");
  assert.equal(tabEngine(s, "chrome"), "chromium");
  assert.equal(tabEngine(s, "link"), "webkit");
  assert.equal(tabEngine(s, "typed"), "webkit");
  assert.equal(tabEngine(s, "copy"), "webkit");
  assert.equal(tabEngine(s, "gone"), "chromium");
});

test("typing an address follows a rule, else keeps the page's engine", () => {
  const s = state([tab("w", { engine: "webkit", url: "https://www.netflix.com/" }), tab("blank")], { websiteEngines: { "https://www.youtube.com": "chromium" } });
  assert.equal(typedNavigationEngine(s, s.tabs.w, "https://www.youtube.com/"), "chromium");
  assert.equal(typedNavigationEngine(s, s.tabs.w, "https://example.com/"), "webkit");
  assert.equal(typedNavigationEngine(s, s.tabs.blank, "https://example.com/"), "chromium");
});

test("Chromium's own pages always open in Chromium", () => {
  const s = state([tab("v", { engine: "webkit", url: "ardia://version" }), tab("w", { engine: "webkit", url: "https://a.com/" })], { pageEngine: "webkit" });
  assert.equal(tabEngine(s, "v"), "chromium");
  assert.equal(typedNavigationEngine(s, s.tabs.w, "ardia://extensions"), "chromium");
  assert.equal(typedNavigationEngine(s, s.tabs.w, "chrome-extension://abc/options.html"), "chromium");
});

test("the mark shows only on web pages away from the default engine", () => {
  const s = state([tab("w", { engine: "webkit", url: "https://a.com/" }), tab("c", { engine: "chromium", url: "https://a.com/" }), tab("n", { engine: "webkit", url: "ardia://history" })]);
  assert.equal(engineMark(s, "w"), "webkit");
  assert.equal(engineMark(s, "c"), null);
  assert.equal(engineMark(s, "n"), null);
});

test("a closed WebKit tab reopens in WebKit, whatever restore id it carries", () => {
  const closed = snapshotTab({ ...makeTab("w1", "default", "https://www.netflix.com/"), engine: "webkit" });
  assert.equal(closed.engine, "webkit");
  const reopened = { ...makeTab("w1", "default", closed.url, closed), adoptId: "restore:old", navigation: null };
  const s = state([reopened]);
  assert.equal(tabEngine(s, reopened.id), "webkit");
  assert.equal(snapshotTab(makeTab("w1", "default", "https://a.com/")).engine, undefined);
});

function recorder() {
  const written = [];
  let clock = 0;
  let next = 0;
  const pending = new Map();
  const visits = visitRecorder((profile, visit) => written.push({ profile, ...visit }), { set: (run, ms) => (pending.set(++next, { run, at: clock + ms }), next), clear: (id) => pending.delete(id) }, () => clock);
  const advance = (ms) => {
    clock += ms;
    for (const [id, timer] of [...pending]) if (timer.at <= clock) (pending.delete(id), timer.run());
  };
  const page = (url, title, isLoading, committedUrl = url) => ({ url, title, isLoading, committedUrl });
  return { visits, written, advance, page };
}

test("a WebKit visit is recorded for the committed page, with that page's own title", () => {
  const { visits, written, advance, page } = recorder();
  visits.note("t", "", page("https://b.com/", "A's title", true, "https://a.com/"));
  advance(1);
  visits.note("t", "", page("https://b.com/", "A's title", true));
  visits.note("t", "", page("https://b.com/", "", true));
  assert.deepEqual(written, []);
  advance(1);
  visits.note("t", "", page("https://b.com/", "B's title", true));
  visits.note("t", "", page("https://b.com/", "B again", false));
  assert.deepEqual(written, [{ profile: "", url: "https://b.com/", title: "B's title", at: 1 }]);
});

test("a page whose title never changes is recorded once it settles, not at once", () => {
  const { visits, written, advance, page } = recorder();
  visits.note("t", "", page("https://b.com/", "Same", false));
  assert.deepEqual(written, []);
  advance(1500);
  assert.deepEqual(written, [{ profile: "", url: "https://b.com/", title: "Same", at: 0 }]);
});

test("a navigation that became a download, or an error page, is never recorded", () => {
  const { visits, written, advance, page } = recorder();
  visits.note("t", "", page("https://f.com/file.zip", "", false, ""));
  visits.note("t", "", page("https://f.com/file.zip", "x", false, "https://a.com/"));
  advance(5000);
  assert.deepEqual(written, []);
});

test("a visit keeps the profile it was made in, even if the tab moves before it settles", () => {
  const { visits, written, advance, page } = recorder();
  visits.note("t", "work", page("https://a.com/", "A", false));
  visits.note("t", "home", page("https://a.com/", "A", false));
  advance(1500);
  assert.deepEqual(written.map((v) => v.profile), ["work"]);
});

test("one visit's settle timer never records the next visit", () => {
  const { visits, written, advance, page } = recorder();
  visits.note("t", "", page("https://a.com/", "A", false));
  advance(1400);
  visits.note("t", "", page("https://b.com/", "A", true));
  advance(100);
  assert.deepEqual(written, [{ profile: "", url: "https://a.com/", title: "A", at: 0 }]);
  advance(1000);
  visits.note("t", "", page("https://b.com/", "B", false));
  assert.deepEqual(written.at(-1), { profile: "", url: "https://b.com/", title: "B", at: 1400 });
});

test("a quick next page still records the one before it, with its own title and time", () => {
  const { visits, written, page, advance } = recorder();
  visits.note("t", "", page("https://a.com/", "Old", true));
  advance(200);
  visits.note("t", "", page("https://a.com/#two", "Old", false));
  assert.deepEqual(written, [{ profile: "", url: "https://a.com/", title: "Old", at: 0 }]);
});

test("a private visit is never written, and a reload of the same page isn't a new visit", () => {
  const { visits, written, page, advance } = recorder();
  visits.note("p", null, page("https://a.com/", "A", false));
  advance(1500);
  visits.note("t", "", page("https://a.com/", "A", false));
  advance(1500);
  visits.note("t", "", page("https://a.com/", "A", true));
  visits.note("t", "", page("https://a.com/", "A", false));
  advance(1500);
  assert.deepEqual(written.length, 1);
});

test("closing a tab records its unsettled visit and forgets the tab", () => {
  const { visits, written, advance, page } = recorder();
  visits.note("t", "", page("https://a.com/", "Old", true));
  visits.close("t");
  assert.deepEqual(written, [{ profile: "", url: "https://a.com/", title: "Old", at: 0 }]);
  assert.equal(visits.size(), 0);
  advance(5000);
  assert.equal(written.length, 1);
});

test("many tabs don't make an open tab record its page again", () => {
  const { visits, written, advance, page } = recorder();
  visits.note("keep", "", page("https://keep.com/", "K", false));
  advance(1500);
  for (let i = 0; i < 1200; i++) {
    visits.note(`t${i}`, "", page(`https://s${i}.com/`, "", false));
    advance(1500);
    visits.close(`t${i}`);
  }
  visits.note("keep", "", page("https://keep.com/", "K", false));
  advance(1500);
  assert.equal(written.filter((v) => v.url === "https://keep.com/").length, 1);
  assert.equal(visits.size(), 1);
});
