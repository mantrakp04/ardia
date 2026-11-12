import assert from "node:assert/strict";
import { test } from "node:test";
import { extensionSuggestions, type ExtensionCandidate } from "./extensionRows.ts";
import { buildSuggestions, type Suggestion } from "./suggest.ts";

const now = Date.UTC(2026, 9, 24);
const ext = (id: string, title: string, action = true, options = true): ExtensionCandidate => ({ id, title, icon: `data:image/png;base64,${id}`, action, options });
const EXTENSIONS = [ext("ublock", "uBlock Origin"), ext("onepassword", "1Password – Password Manager", true, false), ext("darkreader", "Dark Reader"), ext("nopopup", "Video Speed Controller", false, true)];

const keys = (rows: Suggestion[]) => rows.map((r) => (r.kind === "extension" ? `${r.open}:${r.id}` : r.kind));

test("a typed extension name lists it, with its options under the best match", () => {
  const { rows, exact } = extensionSuggestions("ublock", EXTENSIONS);
  assert.equal(exact, false);
  assert.deepEqual(keys(rows), ["action:ublock", "options:ublock"]);
  assert.deepEqual(rows[0], { kind: "extension", id: "ublock", title: "uBlock Origin", icon: "data:image/png;base64,ublock", open: "action" });
});

test("a later word of the name finds it too, and an extension with no options page gets no options row", () => {
  assert.deepEqual(keys(extensionSuggestions("password", EXTENSIONS).rows), ["action:onepassword"]);
  assert.deepEqual(keys(extensionSuggestions("reader", EXTENSIONS).rows), ["action:darkreader", "options:darkreader"]);
});

test("an extension without a toolbar action offers its options only", () => {
  assert.deepEqual(keys(extensionSuggestions("video speed", EXTENSIONS).rows), ["options:nopopup"]);
});

test("two letters list nothing unless they are the whole name, and stray letters never match", () => {
  assert.deepEqual(extensionSuggestions("ub", EXTENSIONS).rows, []);
  assert.deepEqual(extensionSuggestions("zzq", EXTENSIONS).rows, []);
  assert.deepEqual(extensionSuggestions("ublock", []).rows, []);
  const short = extensionSuggestions("ab", [ext("ab", "AB")]);
  assert.equal(short.exact, true);
  assert.deepEqual(keys(short.rows), ["action:ab", "options:ab"]);
});

test("in the bar, a partial name lists the extension after the search row", () => {
  const { items } = buildSuggestions("dark rea", { tabs: [], history: [] }, { now, extensions: EXTENSIONS });
  assert.deepEqual(keys(items), ["search", "action:darkreader", "options:darkreader"]);
});

test("the exact name goes first, unless a visited site completes inline", () => {
  const exact = buildSuggestions("Dark Reader", { tabs: [], history: [] }, { now, extensions: EXTENSIONS });
  assert.deepEqual(keys(exact.items).slice(0, 2), ["action:darkreader", "search"]);
  const history = [{ url: "https://ublock.example/", title: "uBlock site", favicon: null, visits: 9, lastVisit: now - 1000 }];
  const site = buildSuggestions("ublock", { tabs: [], history }, { now, extensions: [ext("ublock", "uBlock")] });
  assert.equal(site.completion, ".example");
  assert.equal(site.items[0]?.kind, "page");
  assert.ok(keys(site.items).includes("action:ublock"));
});

test("without extensions the bar is unchanged", () => {
  const source = { tabs: [], history: [] };
  assert.deepEqual(buildSuggestions("dark reader", source, { now }), buildSuggestions("dark reader", source, { now, extensions: [] }));
});
