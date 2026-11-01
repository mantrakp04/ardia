import assert from "node:assert/strict";
import { test } from "node:test";
import { mount } from "../../test-hooks.mjs";

globalThis.__DEV__ = false;
const { useBrowser } = await import("../../state/browser/store.ts");
const { useSuggestions } = await import("./useSuggestions.ts");
const { scopeFor, offeredScope, keywordScope, currentScopeFor } = await import("../../state/omnibox/scopes.ts");
const { parseSettings, searchEngines } = await import("../../state/settings/settings.ts");
const { saveSiteSearchOverride } = await import("../../state/settings/actions.ts");
const S = () => useBrowser.getState();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function setup() {
  S().hydrate({});
  return S().createWindow();
}

test("site scopes send no remote queries and discard late responses and retained rows", async () => {
  const w = setup();
  const previousFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = (url) => new Promise((resolve) => requests.push({ url, resolve }));
  const h = mount(({ scope, text }) => useSuggestions({ text, scope, active: true, windowId: w, profileId: "default" }), { props: { text: "secret", scope: null } });
  try {
    await delay(150);
    assert.equal(requests.length, 1);
    h.rerender({ text: "secret", scope: scopeFor("docs", w) });
    requests[0].resolve({ ok: true, text: async () => JSON.stringify(["secret", ["secret old suggestion"]]) });
    await delay(170);
    assert.equal(requests.length, 1);
    assert.equal(h.value.items.some((s) => s.suggested), false);
    assert.match(h.value.items[0].url, /^https:\/\/docs.google.com\/document\//);
    h.rerender({ text: "different private query", scope: scopeFor("gmail", w) });
    await delay(150);
    assert.equal(requests.length, 1);
    h.rerender({ text: "secret", scope: null });
    await delay(150);
    assert.equal(requests.length, 2);
    requests[1].resolve({ ok: true, text: async () => JSON.stringify(["secret", ["secret new suggestion"]]) });
    await delay(10);
    assert.equal(h.value.items.some((s) => s.query === "secret new suggestion"), true);
    h.rerender({ text: "secret", scope: scopeFor("claude", w) });
    assert.equal(h.value.items.some((s) => s.suggested), false);
  } finally {
    h.unmount();
    globalThis.fetch = previousFetch;
  }
});

test("saved shortcuts and preset overrides round-trip without changing the default engine", () => {
  const w = setup();
  const added = S().addCustomEngine({ name: "School", keyword: "school", aliases: ["workdocs"], enabled: true, url: "https://docs.google.com/document/u/1/?q=%s" });
  assert.ok(added.id);
  S().setSearchEngine(added.id);
  const docs = { name: "My Docs", keyword: "documents", aliases: [], enabled: true, url: "https://docs.google.com/document/u/1/?q=%s" };
  S().updateSettings({ siteSearchOverrides: { "docs.google.com": docs } });
  const parsed = parseSettings(JSON.parse(JSON.stringify(S().settings)));
  assert.equal(parsed.searchEngine, added.id);
  assert.equal(searchEngines(parsed).find((e) => e.id === added.id).aliases[0], "workdocs");
  assert.deepEqual(parsed.siteSearchOverrides["docs.google.com"], docs);
  assert.equal(offeredScope("documents", ".other.com", w).name, "My Docs");
  S().updateSettings({ siteSearchOverrides: { "docs.google.com": { ...docs, enabled: false } } });
  assert.equal(offeredScope("documents", "", w), null);
  S().removeCustomEngine(added.id);
});


test("preset edits refresh active scopes and disabling or deleting a shortcut stops submission", () => {
  const w = setup();
  const old = scopeFor("docs", w);
  const input = { name: "School Docs", keyword: "documents", aliases: [], url: "https://docs.google.com/document/u/1/?q=%s", enabled: true };
  S().updateSettings({ siteSearchOverrides: { "docs.google.com": input } });
  assert.equal(currentScopeFor(old, w).url, input.url);
  S().updateSettings({ siteSearchOverrides: { "docs.google.com": { ...input, enabled: false } } });
  assert.equal(currentScopeFor(old, w), null);
  const added = S().addCustomEngine({ name: "Work", keyword: "work", url: "https://example.com/?q=%s" });
  const engineScope = scopeFor("work", w);
  S().removeCustomEngine(added.id);
  assert.equal(currentScopeFor(engineScope, w), null);
});

test("saving a stale editor value keeps the latest enabled flag", () => {
  setup();
  const stale = { name: "Docs", keyword: "docs", aliases: [], url: "https://docs.google.com/document/u/0/?q=%s", enabled: true };
  S().updateSettings({ siteSearchOverrides: { "docs.google.com": { ...stale, enabled: false } } }, { fromSync: true });
  saveSiteSearchOverride("docs.google.com", { ...stale, url: "https://docs.google.com/document/u/1/?q=%s" });
  assert.equal(S().settings.siteSearchOverrides["docs.google.com"].enabled, false);
  assert.match(S().settings.siteSearchOverrides["docs.google.com"].url, /\/u\/1\//);
});

test("loaded and synced custom aliases cannot silently select another engine", () => {
  const w = setup();
  const engines = [
    { id: "one", name: "One", keyword: "one", aliases: ["shared", "two", "unique"], url: "https://one.example/?q=%s" },
    { id: "two", name: "Two", keyword: "two", aliases: ["www.shared"], url: "https://two.example/?q=%s" },
  ];
  const parsed = parseSettings({ customSearchEngines: engines, searchEngine: "two" });
  assert.equal(parsed.customSearchEngines.length, 2);
  assert.equal(parsed.searchEngine, "two");
  assert.deepEqual(parsed.customSearchEngines.map((e) => e.aliases), [["unique"], []]);
  S().updateSettings({ customSearchEngines: engines }, { fromSync: true });
  assert.equal(S().settings.customSearchEngines.length, 2);
  assert.equal(scopeFor("shared", w), null);
  assert.equal(scopeFor("two", w).name, "Two");
  assert.equal(scopeFor("unique", w).name, "One");
  const duplicate = parseSettings({ customSearchEngines: [engines[0], { ...engines[1], keyword: "www.one" }] });
  assert.equal(duplicate.customSearchEngines.length, 2);
  assert.ok(duplicate.customSearchEngines.every((e) => e.enabled === false));
});

test("Space accepts normalized custom engine aliases while bare preset names remain ordinary text", () => {
  const w = setup();
  S().addCustomEngine({ name: "Work", keyword: "work", aliases: ["www.school"], url: "https://example.com/?q=%s" });
  assert.equal(keywordScope("school", w).name, "Work");
  for (const name of ["docs", "youtube", "gh"]) assert.equal(keywordScope(name, w), null);
  assert.equal(keywordScope("docs.google.com", w).name, "Google Docs");
});

test("explicit engine scopes also keep remote suggestions off", async () => {
  const w = setup();
  const oldFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => { requests.push(url); return { ok: true, text: async () => '[]' }; };
  const engineScope = scopeFor("google", w);
  const h = mount(() => useSuggestions({ text: "private query", scope: engineScope, active: true, windowId: w, profileId: "default" }));
  try {
    await delay(170);
    assert.deepEqual(requests, []);
    assert.equal(h.value.items.some((s) => s.suggested), false);
  } finally { h.unmount(); globalThis.fetch = oldFetch; }
});
