import assert from "node:assert/strict";
import { test } from "node:test";
const { urlBarMenuItems, fieldMenuItems } = await import("./paste.ts");

const G = { control: "⌃", option: "⌥", shift: "⇧", command: "⌘" };
const keys = (i) => (i.key ? ["control", "option", "shift", "command"].filter((m) => i.modifiers?.includes(m)).map((m) => G[m]).join("") + i.key.toUpperCase() : "");
const render = (items) =>
  items.map((i) => (i.separator ? "---" : [i.checked ? "✓" : "", i.title, keys(i), i.symbol ? `[${i.symbol}]` : "", i.enabled === false ? "(off)" : "", i.alternate ? "(alt)" : "", i.share ? "(share)" : ""].filter(Boolean).join(" ")));

test("the address field menu: Copy Link with its real shortcut and Markdown alternate, Paste and Go, then Share", () => {
  assert.deepEqual(render(urlBarMenuItems({ paste: { kind: "go", url: "https://a.com/" }, shareable: true })), [
    "Copy Link ⇧⌘C [link]",
    "Copy Link as Markdown ⌥⇧⌘C [link] (alt)",
    "Paste and Go [arrow.right.circle]",
    "---",
    "Share [square.and.arrow.up] (share)",
  ]);
  assert.deepEqual(render(urlBarMenuItems({ paste: { kind: "search", query: "cats" }, shareable: false })), [
    "Copy Link ⇧⌘C [link]",
    "Copy Link as Markdown ⌥⇧⌘C [link] (alt)",
    "Paste and Search [magnifyingglass]",
  ]);
  assert.deepEqual(render(urlBarMenuItems({ paste: null, shareable: false, keys: () => ({}) })), ["Copy Link [link]", "Copy Link as Markdown [link] (alt)"]);
});

test("the command bar field keeps the text-editing menu with the Edit menu's keys", () => {
  assert.deepEqual(render(fieldMenuItems({ paste: { kind: "go", url: "https://a.com/" }, hasSelection: false, hasText: true })), [
    "Paste and Go [arrow.right.circle]",
    "---",
    "Cut ⌘X (off)",
    "Copy ⌘C (off)",
    "Paste ⌘V",
    "---",
    "Select All ⌘A",
  ]);
  assert.deepEqual(render(fieldMenuItems({ paste: null, hasSelection: true, hasText: false })), ["Cut ⌘X", "Copy ⌘C", "Paste ⌘V (off)", "---", "Select All ⌘A (off)"]);
});
