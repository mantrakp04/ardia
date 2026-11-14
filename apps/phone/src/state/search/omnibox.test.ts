import assert from "node:assert/strict";
import { test } from "node:test";
import { enterTarget, rowTarget, setSources, suggest } from "./omnibox.ts";

const context = { currentUrl: null, currentTabId: null };

test("tapping the top row does what Enter does, for addresses and for words", () => {
  setSources({ tabs: [], history: [], bookmarks: [] });
  for (const text of ["https://www.google.com/search?q=otters", "example.com", "example.com/a/b", "otter facts"]) {
    for (const remote of [[], [text, "otters"]]) {
      const top = suggest(text, remote, context).rows[0]!;
      assert.deepEqual(rowTarget(top), enterTarget(text), `${text} with ${remote.length} remote`);
    }
  }
});

test("an address typed in full opens, and no row searches the engine for the address itself", () => {
  setSources({ tabs: [], history: [], bookmarks: [] });
  for (const text of ["https://www.google.com/search?q=otters", "example.com", "example.com/a/b"]) {
    const rows = suggest(text, [text], context).rows;
    const target = enterTarget(text)!;
    assert.equal(target.origin, "typed");
    for (const row of rows) {
      const opens = rowTarget(row);
      if (opens?.origin === "search") assert.ok(!decodeURIComponent(opens.url).includes(text), `${text}: ${opens.url}`);
    }
    assert.equal(rows.filter((row) => rowTarget(row)?.url === target.url).length, 1, text);
  }
});

test("words search the engine from the row and from Enter alike", () => {
  setSources({ tabs: [], history: [], bookmarks: [] });
  const target = enterTarget("otter facts")!;
  assert.equal(target.origin, "search");
  assert.match(target.url, /otter(%20|\+)facts/);
  assert.deepEqual(rowTarget(suggest("otter facts", [], context).rows[0]!), target);
});
