import assert from "node:assert/strict";
import { test } from "node:test";
import { recentTabSuggestions, type OpenTabRow } from "./openTabs.ts";

const tab = (id: string, lastActiveAt: number, url = `https://${id}.example/`): OpenTabRow => ({ id, url, title: id.toUpperCase(), favicon: null, lastActiveAt });

test("open tabs come most recently used first, as Switch to Tab rows", () => {
  const rows = recentTabSuggestions([tab("a", 1), tab("b", 3), tab("c", 2)]);
  assert.deepEqual(
    rows.map((r) => (r.kind === "page" ? r.tabId : null)),
    ["b", "c", "a"],
  );
  assert.deepEqual(rows[0], { kind: "page", url: "https://b.example/", title: "B", favicon: null, tabId: "b" });
});

test("the tab the bar is over and tabs without a page are left out", () => {
  const rows = recentTabSuggestions([tab("a", 5), tab("blank", 9, ""), tab("b", 4)], { exclude: "a" });
  assert.deepEqual(
    rows.map((r) => (r.kind === "page" ? r.tabId : null)),
    ["b"],
  );
});

test("the list stops at the limit and leaves its input alone", () => {
  const tabs = Array.from({ length: 12 }, (_, i) => tab(`t${i}`, i));
  const before = tabs.map((t) => t.id);
  const rows = recentTabSuggestions(tabs, { limit: 3 });
  assert.deepEqual(
    rows.map((r) => (r.kind === "page" ? r.tabId : null)),
    ["t11", "t10", "t9"],
  );
  assert.deepEqual(
    tabs.map((t) => t.id),
    before,
  );
  assert.equal(recentTabSuggestions(tabs).length, 8);
});

test("tabs sharing a URL each keep their own row", () => {
  const rows = recentTabSuggestions([tab("a", 1, "https://same.example/"), tab("b", 2, "https://same.example/")]);
  assert.equal(rows.length, 2);
});
