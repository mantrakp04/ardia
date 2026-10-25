import assert from "node:assert/strict";
import { test } from "node:test";

const { byRecentUse, groupTabIds, matchingRows } = await import("./groupPanelRows.ts");
const { ago } = await import("../../lib/timeAgo.ts");

const tab = (id, title, url, usedAt) => ({ id, title, url, usedAt });

test("a group lists its own tabs and every nested group's, once each", () => {
  const groups = {
    top: { tabIds: ["a", "b", "c"] },
    inner: { tabIds: ["b", "d"], parentId: "top" },
    deeper: { tabIds: ["e"], parentId: "inner" },
    other: { tabIds: ["z"] },
  };
  assert.deepEqual(groupTabIds(groups, "top"), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(groupTabIds(groups, "inner"), ["b", "d", "e"]);
  assert.deepEqual(groupTabIds(groups, "missing"), []);
});

test("rows come most recently used first", () => {
  const rows = [tab("a", "A", "https://a.com", 1), tab("b", "B", "https://b.com", 3), tab("c", "C", "https://c.com", 2)];
  assert.deepEqual(byRecentUse(rows).map((r) => r.id), ["b", "c", "a"]);
});

test("a query matches title, host and URL, and keeps recent use as the tie-break", () => {
  const rows = byRecentUse([
    tab("docs", "Python docs", "https://docs.python.org/3/", 5),
    tab("pypi", "Package index", "https://pypi.org/", 4),
    tab("news", "News", "https://example.com/", 3),
    tab("long", "One two three four five six seven eight nine ten py", "https://example.org/", 2),
  ]);
  assert.deepEqual(matchingRows("", rows), rows);
  assert.deepEqual(matchingRows("py", rows).map((r) => r.id).sort(), ["docs", "long", "pypi"]);
  assert.deepEqual(matchingRows("zzz", rows), []);
  assert.equal(matchingRows("python", rows)[0].id, "docs");
});

test("relative times read like Arc's", () => {
  const now = 1_000_000_000_000;
  assert.equal(ago(now - 10_000, now), "just now");
  assert.equal(ago(now - 60_000, now), "1 minute ago");
  assert.equal(ago(now - 17 * 3_600_000, now), "17 hours ago");
  assert.equal(ago(now - 24 * 3_600_000, now), "yesterday");
  assert.equal(ago(now - 3 * 86_400_000, now), "3 days ago");
  assert.equal(ago(now - 14 * 86_400_000, now), "2 weeks ago");
  assert.equal(ago(now - 60 * 86_400_000, now), "2 months ago");
  assert.equal(ago(now - 400 * 86_400_000, now), "1 year ago");
  assert.equal(ago(now + 5_000, now), "just now");
});
