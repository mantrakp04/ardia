import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILT_IN_ENGINES } from "./engines.ts";
import { asksForBackspace, keywordBySpace, offeredSiteSearch, scopedSearchUrl, siteSearchKey, type SearchScope, type SiteSearchKeyState } from "./siteSearch.ts";

const sources = { engines: BUILT_IN_ENGINES };

test("an empty site search opens the completed address that entered it", () => {
  const entry = siteSearchKey("Tab", {}, bar("git", "hub.com/ardia"));
  assert.equal(entry?.kind, "enter");
  if (entry?.kind !== "enter") return;
  assert.equal(scopedSearchUrl(entry.scope, "", BUILT_IN_ENGINES[0]!, entry.from), "https://github.com/ardia");
});

test("an empty engine keyword search opens the engine's site", () => {
  const scope = offeredSiteSearch("google", "", sources)!;
  assert.equal(scopedSearchUrl(scope, "", BUILT_IN_ENGINES[0]!, "google "), "https://google.com");
});

test("whitespace-only scoped searches open the original address", () => {
  const scope = offeredSiteSearch("x.com", "", sources)!;
  assert.equal(scopedSearchUrl(scope, "  ", BUILT_IN_ENGINES[0]!, "https://x.com/home "), "https://x.com/home");
});

test("an empty history scope opens its site instead of searching for the site filter", () => {
  const scope: SearchScope = { kind: "history", name: "example.org", host: "example.org", url: "" };
  assert.equal(scopedSearchUrl(scope, "", BUILT_IN_ENGINES[0]!), "https://example.org");
});

test("an empty history search preserves paths on an unrecognized domain suffix", () => {
  const scope = offeredSiteSearch("foo.zzzz/x", "", { ...sources, hosts: ["foo.zzzz"] })!;
  assert.equal(scope.kind, "history");
  assert.equal(scopedSearchUrl(scope, "", BUILT_IN_ENGINES[0]!, "foo.zzzz/x "), "https://foo.zzzz/x");
});

test("an empty site keyword search opens the site's host", () => {
  const scope = offeredSiteSearch("github", "", sources)!;
  assert.equal(scopedSearchUrl(scope, "", BUILT_IN_ENGINES[0]!, "github "), "https://github.com");
});

test("an empty custom engine search does not turn an unrecognized keyword into an address", () => {
  const scope: SearchScope = { kind: "engine", name: "Example", host: "example.com", url: "https://example.com/search?q=%s" };
  assert.equal(scopedSearchUrl(scope, "", BUILT_IN_ENGINES[0]!, "foo.zzzz/x "), "https://example.com");
});

test("a nonempty site search still searches the chosen site", () => {
  const scope = offeredSiteSearch("github.com", "", sources)!;
  assert.equal(scopedSearchUrl(scope, "  ardia browser  ", BUILT_IN_ENGINES[0]!, "github.com/ardia"), "https://github.com/search?q=ardia%20browser");
});

function bar(typed: string, completion = "", scope: SearchScope | null = null, scopeFrom = ""): SiteSearchKeyState {
  return { typed, completion, scope, offered: scope ? null : offeredSiteSearch(typed, completion, sources), scopeFrom };
}

test("Tab enters site search while inline completion is showing: 'google' + '.com'", () => {
  const state = bar("google", ".com");
  assert.equal(state.offered?.name, "Google");
  const action = siteSearchKey("Tab", {}, state);
  assert.equal(action?.kind, "enter");
  assert.equal(action?.kind === "enter" && action.scope.name, "Google");
  assert.equal(action?.kind === "enter" && action.from, "google.com");
});

test("Tab enters site search from a short prefix the completion finishes: 'goo' + 'gle.com'", () => {
  const action = siteSearchKey("Tab", {}, bar("goo", "gle.com"));
  assert.deepEqual(action?.kind === "enter" && [action.scope.name, action.from], ["Google", "goo" + "gle.com"]);
});

test("Tab enters site search for a typed site with no completion: 'x.com'", () => {
  const action = siteSearchKey("Tab", {}, bar("x.com"));
  assert.deepEqual(action?.kind === "enter" && [action.scope.kind, action.scope.name, action.from], ["site", "X", "x.com"]);
});

test("Tab accepts the completion when the row offers no site search", () => {
  const state = bar("exampl", "e.org");
  assert.equal(state.offered, null);
  assert.deepEqual(siteSearchKey("Tab", {}, state), { kind: "accept", text: "example.org" });
});

test("Tab with nothing to enter or accept is left to the caller (it moves the selection)", () => {
  assert.equal(siteSearchKey("Tab", {}, bar("hello world")), null);
  assert.equal(siteSearchKey("Tab", {}, bar("")), null);
});

test("Shift+Tab never enters site search", () => {
  assert.equal(siteSearchKey("Tab", { shiftKey: true }, bar("google", ".com")), null);
});

test("Tab inside site search does not enter it again", () => {
  const google = bar("google", ".com").offered!;
  assert.equal(siteSearchKey("Tab", {}, bar("", "", google, "google.com")), null);
});

test("Backspace in an empty site search field leaves it and restores the text that was there", () => {
  const x = bar("x.com").offered!;
  const state = bar("", "", x, "x.com");
  assert.deepEqual(siteSearchKey("Backspace", {}, state), { kind: "leave", text: "x.com" });
});

test("site search entered by typing a space leaves with the space: 'x.com ' then Backspace gives 'x.com '", () => {
  const entry = keywordBySpace("x.com", "x.com ");
  assert.deepEqual(entry, { keyword: "x.com", from: "x.com " });
  const x = bar("x.com").offered!;
  assert.deepEqual(siteSearchKey("Backspace", {}, bar("", "", x, entry!.from)), { kind: "leave", text: "x.com " });
});

test("a space typed after the restored 'x.com ' is a plain space, it doesn't enter site search again", () => {
  assert.equal(keywordBySpace("x.com ", "x.com  "), null);
});

test("only a space typed at the end of the text enters site search by keyword", () => {
  assert.equal(keywordBySpace("x.com", "x.coma"), null);
  assert.equal(keywordBySpace("x.com", " x.com"), null);
  assert.equal(keywordBySpace("", " "), null);
});

test("site search asks for Backspace the whole time it is on, so typing never races the registration", () => {
  const x = bar("x.com").offered!;
  assert.equal(asksForBackspace(x), true);
  assert.equal(asksForBackspace(null), false);
});

test("a forwarded Backspace leaves even while JS still holds text the field already deleted", () => {
  const x = bar("x.com").offered!;
  assert.deepEqual(siteSearchKey("Backspace", {}, bar("a", "", x, "x.com")), { kind: "leave", text: "x.com" });
});

test("Backspace with a modifier never leaves site search: the field deletes as usual", () => {
  const state = bar("", "", bar("x.com").offered!, "x.com");
  for (const mods of [{ altKey: true }, { metaKey: true }, { shiftKey: true }, { ctrlKey: true }]) {
    assert.equal(siteSearchKey("Backspace", mods, state), null);
  }
});

test("Backspace outside site search is a plain delete", () => {
  assert.equal(siteSearchKey("Backspace", {}, bar("x.co")), null);
  assert.equal(siteSearchKey("Backspace", {}, bar("")), null);
});

test("Ctrl+Tab is left to the tab switcher", () => {
  assert.equal(siteSearchKey("Tab", { ctrlKey: true }, bar("google", ".com")), null);
});

test("no site search is offered for text with spaces", () => {
  assert.equal(offeredSiteSearch("google maps", "", sources), null);
  assert.equal(offeredSiteSearch("  ", ".com", sources), null);
});
