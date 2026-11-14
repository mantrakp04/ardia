import assert from "node:assert/strict";
import { test } from "node:test";
import { mount } from "../../test-hooks.mjs";

globalThis.__DEV__ = false;
const { providerApprovalKey } = await import("@ardia/core");
const { useBrowser } = await import("../../state/browser/store.ts");
const { useSuggestions } = await import("./useSuggestions.ts");
const { keywordScope, offeredScope } = await import("../../state/omnibox/scopes.ts");
const { approveOmniboxProvider } = await import("../../state/omnibox/providerApproval.ts");
const { registerOmniboxProvider } = await import("../../state/omnibox/providers.ts");
const { heldIndex, heldKey } = await import("./heldSelection.ts");

const S = () => useBrowser.getState();
const settle = () => new Promise((r) => setImmediate(r));
const TEAM = { title: "Team", rows: [{ title: "Zebra board", url: "https://board.team.example/" }, { title: "Zebra wiki", url: "https://wiki.team.example/" }] };
const LINEAR = { keyword: "go", title: "Linear", url: "https://linear.app/team/issue/{query}" };

function setup(entries) {
  S().hydrate({});
  const w = S().createWindow({ url: "https://start.example/" });
  S().updateSettings({ omniboxProviders: entries });
  useBrowser.setState((s) => ({
    history: { ...s.history, "": { list: [{ url: "https://zebra.example/", title: "Zebra", favicon: null, visits: 3, lastVisit: Date.now(), visitTimes: [Date.now()] }], floor: -Infinity, ready: true } },
  }));
  return w;
}

const bar = (w, text, scope = null) => mount((p) => useSuggestions({ text: p.text, active: true, windowId: w, profileId: "default", scope: p.scope }), { props: { text, scope } });
const shown = (items) => items.map((s) => (s.kind === "provider" ? `provider:${s.title}` : s.kind === "page" ? `page:${s.url}` : s.kind));

test("a global static provider streams in after the built-in rows, once approved", async () => {
  const w = setup([TEAM]);
  const h = bar(w, "zebra");
  await settle();
  assert.equal(shown(h.value.items).some((x) => x.startsWith("provider:")), false, "not approved: nothing");
  approveOmniboxProvider(providerApprovalKey(TEAM));
  h.rerender({ text: "zebr", scope: null });
  const first = shown(h.value.items);
  assert.equal(first.some((x) => x.startsWith("provider:")), false, "built-ins render first");
  await settle();
  const after = shown(h.value.items);
  assert.deepEqual(after.filter((x) => x.startsWith("provider:")), ["provider:Zebra board", "provider:Zebra wiki"]);
  assert.notEqual(after[0], "provider:Zebra board");
  assert.equal(h.value.completion, "a.example", "the completion stays a page");
  h.unmount();
});

test("a keyword enters its provider by Space or Tab; only its rows show, the template first", async () => {
  const w = setup([LINEAR, { keyword: "t", ...TEAM }]);
  assert.equal(keywordScope("go", w)?.providerId, "config:go");
  assert.equal(offeredScope("go", "", w)?.name, "Linear");
  const scope = keywordScope("t", w);
  const h = bar(w, "", scope);
  await settle();
  assert.deepEqual(shown(h.value.items), ["provider:Zebra board", "provider:Zebra wiki"], "nothing typed: every row");
  h.rerender({ text: "wiki", scope });
  await settle();
  assert.deepEqual(shown(h.value.items), ["provider:Zebra wiki"]);
  const go = bar(w, "ENG-7", keywordScope("go", w));
  assert.deepEqual(go.value.items.map((s) => s.url), ["https://linear.app/team/issue/ENG-7"]);
  h.unmount();
  go.unmount();
});

test("a program provider is off in a private window and its keyword never shadows the file's", async () => {
  const w = setup([LINEAR]);
  const asked = [];
  const off = registerOmniboxProvider({ id: "prog", title: "Prog", keyword: "go", query: async (t) => (asked.push(t), []) });
  const offGlobal = registerOmniboxProvider({ id: "progGlobal", title: "Prog", query: async (t) => (asked.push(t), [{ title: "From program", url: "https://prog.example/" }]) });
  assert.equal(keywordScope("go", w)?.providerId, "config:go");
  const h = bar(w, "zebra");
  await settle();
  assert.ok(shown(h.value.items).includes("provider:From program"));
  const privateWindow = S().createWindow({ url: "https://start.example/", kind: "private" });
  assert.equal(S().windows[privateWindow]?.kind, "private");
  asked.length = 0;
  const hp = bar(privateWindow, "zebra");
  await settle();
  assert.deepEqual(asked, [], "a private window never asks a program");
  assert.equal(keywordScope("go", privateWindow)?.providerId, "config:go", "the file's static keyword providers still work there");
  hp.unmount();
  off();
  offGlobal();
  h.unmount();
});

test("late rows never move the selection off the row it was on", () => {
  const row = (url) => ({ kind: "page", url, title: url, favicon: null });
  const before = [row("https://a/"), row("https://b/"), row("https://c/")];
  const prev = { items: before, typed: "x", scope: null, key: "page:https://c" };
  const after = [before[0], before[1], { kind: "provider", providerId: "p", provider: "P", title: "late", url: "https://late/", icon: null }, before[2]];
  assert.equal(heldIndex(prev, after, "x", null, 2), 3);
  assert.equal(heldIndex(prev, after, "xy", null, 0), 0, "typing starts over");
  assert.equal(heldIndex(prev, before, "x", null, 1), 1, "same items: the user's move stands");
});

test("the default row is never held: a row moving off the top doesn't become a preview", () => {
  const row = (url) => ({ kind: "page", url, title: url, favicon: null });
  const search = { kind: "search", query: "n", url: "https://search/?q=n" };
  const page = row("https://narasaka.dev/");
  const before = [page, search];
  const after = [search, page];
  const key = heldKey(before, 0);
  assert.equal(key, null);
  assert.equal(heldIndex({ items: before, typed: "n", scope: null, key }, after, "n", null, 0), 0);
  assert.equal(heldKey(before, 1), "search:https://search/?q=n");
});
