import assert from "node:assert/strict";
import { test } from "node:test";
import { mount } from "../../test-hooks.mjs";

globalThis.__DEV__ = false;
const { useBrowser } = await import("../../state/browser/store.ts");
const { useSuggestions } = await import("./useSuggestions.ts");
const { scopeFor, offeredScope } = await import("../../state/omnibox/scopes.ts");
const { parseSettings, searchEngines } = await import("../../state/settings/settings.ts");
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
