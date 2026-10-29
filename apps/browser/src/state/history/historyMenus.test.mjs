import assert from "node:assert/strict";
import { test } from "node:test";
const { shownSelection } = await import("./historyMenus.ts");

const rows = (...urls) => urls.map((url) => ({ entry: { url } }));

test("a search keeps only the selected rows it still shows, so a row's menu acts on the rows in view", () => {
  const both = new Set(["https://a.com/", "https://b.com/"]);
  assert.equal(shownSelection(both, rows("https://a.com/", "https://b.com/", "https://c.com/")), both, "nothing hidden, the same selection");
  assert.deepEqual([...shownSelection(both, rows("https://a.com/"))], ["https://a.com/"], "b is hidden by the search, so it leaves the selection");
  assert.deepEqual([...shownSelection(both, rows())], []);
  const none = new Set();
  assert.equal(shownSelection(none, rows()), none);
});
