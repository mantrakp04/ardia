import assert from "node:assert/strict";
import { test } from "node:test";

const setTimeoutHoldingExit = globalThis.setTimeout;
globalThis.setTimeout = (callback, ms, ...args) => {
  const timer = setTimeoutHoldingExit(callback, ms, ...args);
  return ms >= 1_000 ? timer.unref() : timer;
};

globalThis.__DEV__ = false;
const { useBrowser } = await import("../browser/store.ts");
const model = await import("../browser/model.ts");
const { reloadHistory, startHistory } = await import("../history/engineSync.ts");
const { reloadBookmarks, startBookmarks } = await import("../bookmarks/engineSync.ts");
const { startExtensionsBridge } = await import("../extensions/bridge.ts");
const { refreshExtensions } = await import("../extensions/actions.ts");
const stub = await import("../../test-native/index.ts");

const S = () => useBrowser.getState();
const settle = () => new Promise((r) => setTimeout(r, 30));
const callsFor = (engine, domain) => stub.engineCalls.filter((c) => c.profile === engine && c.domain === domain).map((c) => `${c.domain}.${c.verb}`);

test("a profile that left the app is not read again: no history, bookmarks or extensions call, no warning", async () => {
  S().hydrate({});
  stub.docs.clear();
  stub.historyDbs.clear();
  const warnings = [];
  const warn = console.warn;
  console.warn = (...args) => void warnings.push(args.map(String).join(" "));
  const stops = [startHistory(), startBookmarks()];
  try {
    startExtensionsBridge();
    const doomed = S().createProfile({ name: "Doomed" });
    const engine = model.engineProfile(S(), doomed);
    assert.notEqual(engine, "", "the profile has data of its own");
    await reloadHistory();
    await reloadBookmarks();
    await refreshExtensions(engine);
    assert.deepEqual(callsFor(engine, "history").includes("history.query"), true, "its history was read while it was in the app");
    assert.deepEqual(callsFor(engine, "bookmarks").includes("bookmarks.tree"), true, "its bookmarks were read while it was in the app");
    assert.deepEqual(callsFor(engine, "extensions"), ["extensions.list"], "its extensions were listed while it was in the app");

    S().deleteProfile(doomed);
    assert.ok(!S().profiles[doomed], "the profile is gone from the app");
    await settle();
    stub.engineCalls.length = 0;
    warnings.length = 0;

    stub.chromeHistoryEvent({ kind: "deleted", profile: engine, all: true, urls: [] });
    stub.chromeBookmarkEdit(engine, []);
    stub.emitEvent("extensions.changed", { profile: engine });
    await settle();

    assert.deepEqual(stub.engineCalls.filter((c) => c.profile === engine), [], "nothing is asked of the deleted profile");
    assert.deepEqual(warnings, [], "and nothing is logged for it");

    stub.chromeHistoryEvent({ kind: "deleted", profile: "", all: true, urls: [] });
    stub.chromeBookmarkEdit("", []);
    stub.emitEvent("extensions.changed", { profile: "" });
    await settle();
    assert.ok(callsFor("", "history").includes("history.query"), "history of a profile in the app is read again");
    assert.ok(callsFor("", "bookmarks").includes("bookmarks.tree"), "bookmarks of a profile in the app are read again");
    assert.ok(callsFor("", "extensions").includes("extensions.list"), "extensions of a profile in the app are listed again");
  } finally {
    console.warn = warn;
    for (const stop of stops) stop();
  }
});

test("a profile that shares its data with another stays in sync when one of them is deleted", async () => {
  S().hydrate({});
  stub.docs.clear();
  stub.historyDbs.clear();
  const stops = [startHistory(), startBookmarks()];
  try {
    const a = S().createProfile({ name: "A" });
    const b = S().createProfile({ name: "B", shareWith: a });
    const engine = model.engineProfile(S(), a);
    assert.equal(model.engineProfile(S(), b), engine);
    await reloadHistory();
    await reloadBookmarks();
    S().deleteProfile(a);
    await settle();
    stub.engineCalls.length = 0;
    stub.chromeHistoryEvent({ kind: "deleted", profile: engine, all: true, urls: [] });
    stub.chromeBookmarkEdit(engine, []);
    await settle();
    assert.ok(callsFor(engine, "history").includes("history.query"), "history is still read for the profile that is left");
    assert.ok(callsFor(engine, "bookmarks").includes("bookmarks.tree"), "bookmarks are still read for the profile that is left");
  } finally {
    for (const stop of stops) stop();
  }
});
