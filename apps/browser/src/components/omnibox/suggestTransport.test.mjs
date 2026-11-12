import assert from "node:assert/strict";
import { test } from "node:test";
import { mount } from "../../test-hooks.mjs";

globalThis.__DEV__ = false;
const { useBrowser } = await import("../../state/browser/store.ts");
const { useSuggestions } = await import("./useSuggestions.ts");
const { engineCalls } = await import("../../test-native/ardiacore.ts");

const S = () => useBrowser.getState();
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));
const remoteRows = (result) => result.items.filter((x) => x.kind === "search").map((x) => x.text ?? x.query ?? x.title);

test("search suggestions go through the browser's own network stack, never the app's fetch", async () => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://start.example/" });
  const asked = [];
  const appFetch = globalThis.fetch;
  let appFetches = 0;
  globalThis.fetch = (...args) => (appFetches++, appFetch(...args));
  globalThis.acTestSuggest = ({ url, profile }) => {
    asked.push({ url, profile });
    const q = new URL(url).searchParams.get("q");
    return {
      status: 200,
      body: `)]}'\n${JSON.stringify([q, [`${q} login`, `https://${q}.com/`, `https://my.${q}.com/`, `${q} pricing`], [], [], { "google:suggesttype": ["QUERY", "NAVIGATION", "PERSONALIZED_NAVIGATION", "QUERY"] }])}`,
    };
  };
  try {
    engineCalls.length = 0;
    const h = mount(({ text }) => useSuggestions({ text, active: true, windowId: w, profileId: "default", scope: null }), { props: { text: "1pass" } });
    await settle();
    h.rerender({ text: "1password" });
    await settle();
    const value = h.rerender({ text: "1password" });
    assert.equal(appFetches, 0, "no suggestion request leaves through React Native's fetch");
    assert.ok(asked.length >= 1);
    for (const a of asked) {
      const url = new URL(a.url);
      assert.equal(`${url.origin}${url.pathname}`, "https://www.google.com/complete/search");
      assert.equal(url.searchParams.get("client"), "chrome");
      assert.equal(a.profile, "", "the default profile's engine data");
    }
    const rows = JSON.stringify(value.items);
    assert.ok(rows.includes("1password login") && rows.includes("1password pricing"), "query rows shown");
    assert.ok(!rows.includes("https://1password.com/") && !rows.includes("https://my.1password.com/"), "Google's navigation rows are not shown as queries");
    h.unmount();
  } finally {
    globalThis.fetch = appFetch;
    delete globalThis.acTestSuggest;
  }
});

test("a refused suggestion request shows no suggestions", async () => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://start.example/" });
  globalThis.acTestSuggest = () => ({ status: 429 });
  try {
    const h = mount(({ text }) => useSuggestions({ text, active: true, windowId: w, profileId: "default", scope: null }), { props: { text: "zz" } });
    await settle();
    const value = h.rerender({ text: "zz" });
    assert.ok(!JSON.stringify(value.items).includes("zz login"));
    h.unmount();
  } finally {
    delete globalThis.acTestSuggest;
  }
});

test("each profile asks its own engine profile, and a private window asks nothing", async () => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://start.example/" });
  const work = S().createProfile({ name: "Work" });
  const asked = [];
  globalThis.acTestSuggest = ({ url, profile }) => {
    asked.push(profile);
    const q = new URL(url).searchParams.get("q");
    return { status: 200, body: JSON.stringify([q, [`${q} from ${profile || "default"}`]]) };
  };
  try {
    const h = mount(({ text, profileId }) => useSuggestions({ text, active: true, windowId: w, profileId, scope: null }), { props: { text: "same", profileId: "default" } });
    await settle();
    assert.ok(JSON.stringify(h.rerender({ text: "same", profileId: "default" }).items).includes("same from default"));
    h.rerender({ text: "same", profileId: work });
    await settle();
    const atWork = JSON.stringify(h.rerender({ text: "same", profileId: work }).items);
    assert.ok(!atWork.includes("same from default"), "the first profile's cached reply is not reused");
    assert.equal(asked.length, 2, "the second profile asked for itself");
    const before = asked.length;
    h.rerender({ text: "secret", profileId: "incognito:p1" });
    await settle();
    h.rerender({ text: "secret", profileId: "incognito:p1" });
    assert.equal(asked.length, before, "a private window sends nothing");
    h.unmount();
  } finally {
    delete globalThis.acTestSuggest;
  }
});
