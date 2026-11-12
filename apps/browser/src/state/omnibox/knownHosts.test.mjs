import assert from "node:assert/strict";
import { test } from "node:test";
import { knownHosts } from "./knownHosts.ts";

const tab = (id, profileId, url) => ({ id, profileId, url });
const entry = (url) => ({ url, title: "", favicon: null, visits: 1, lastVisit: 0 });
const view = (list) => ({ list, floor: -Infinity, ready: true });

test("known hosts: open tabs of the profile, then its history hosts, once each", () => {
  const tabs = { a: tab("a", "p", "https://www.github.com/x"), b: tab("b", "q", "https://other.org/"), c: tab("c", "p", ""), d: tab("d", "p", "https://x.com/") };
  const history = { p: view([entry("https://x.com/home"), entry("https://news.ycombinator.com/"), entry("https://x.com/b")]) };
  const s = { tabs, profiles: {}, history };
  assert.deepEqual(knownHosts(s, "p"), ["github.com", "x.com", "x.com", "news.ycombinator.com"]);
  assert.equal(knownHosts(s, "p"), knownHosts(s, "p"));
  assert.deepEqual(knownHosts(s, "q"), ["other.org"]);
  assert.deepEqual(knownHosts(s, "p"), ["github.com", "x.com", "x.com", "news.ycombinator.com"]);
});

test("known hosts follow a new tabs map and a new history list", () => {
  const history = { p: view([entry("https://a.com/")]) };
  const s1 = { tabs: { a: tab("a", "p", "https://b.com/") }, profiles: {}, history };
  assert.deepEqual(knownHosts(s1, "p"), ["b.com", "a.com"]);
  const s2 = { tabs: { ...s1.tabs, c: tab("c", "p", "https://c.com/") }, profiles: {}, history };
  assert.deepEqual(knownHosts(s2, "p"), ["b.com", "c.com", "a.com"]);
  const s3 = { tabs: s2.tabs, profiles: {}, history: { p: view([entry("https://d.com/")]) } };
  assert.deepEqual(knownHosts(s3, "p"), ["b.com", "c.com", "d.com"]);
  assert.deepEqual(knownHosts({ tabs: {}, profiles: {}, history: {} }, "none"), []);
});
