import assert from "node:assert/strict";
import { test } from "node:test";
import type { TrayRow } from "./omnibox.ts";
import { PASTE_ROW_KEY, withPasteRow } from "./pasteRow.ts";

const recent: TrayRow = { key: "q:otters", kind: "query", title: "otters", url: "https://duckduckgo.com/?q=otters", query: "otters" };

test("Paste and Go leads the empty tray when something was copied", () => {
  const rows = withPasteRow([recent], "", "text");
  assert.equal(rows[0]?.key, PASTE_ROW_KEY);
  assert.equal(rows[0]?.kind === "paste" && rows[0].title, "Paste and Go");
  assert.equal(rows[0]?.kind === "paste" && rows[0].detail, "Text You Copied");
  assert.equal(rows[1], recent);
  const link = withPasteRow([], " ", "link")[0];
  assert.equal(link?.kind === "paste" && link.detail, "Link You Copied");
});

test("the paste row goes once anything is typed, or with nothing copied", () => {
  assert.deepEqual(withPasteRow([recent], "ot", "text"), [recent]);
  assert.deepEqual(withPasteRow([recent], "", null), [recent]);
});
