import assert from "node:assert/strict";
import { test } from "node:test";
import { turboModules } from "../test-native/reactNative.ts";

const calls = [];
let refuseCreates = 0;
let createGate = null;

turboModules.ArdiaEngineHost = {
  available: () => true,
  hostCall: async (verb, argsJson, windowId) => {
    const args = JSON.parse(argsJson);
    calls.push({ verb, args, windowId });
    if (verb === "tab.create") {
      if (createGate) await createGate;
      if (refuseCreates > 0) {
        refuseCreates -= 1;
        return JSON.stringify({ error: "the profile did not load" });
      }
      return JSON.stringify({ tab: calls.length });
    }
    return JSON.stringify({ ok: true });
  },
  engineCall: async () => "{}",
};

const { mountPage, callPage, releasePage } = await import("../../../../packages/expo-windows/src/engine/pages.ts");
const { holdPrivateSession, privateWindowShown, releaseProfile } = await import("../../../../packages/expo-windows/src/engine/privateWindows.ts");

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const creates = (key) => calls.filter((call) => call.verb === "tab.create" && call.args.key === key).length;
const quietWarnings = () => {
  const warn = console.warn;
  console.warn = () => {};
  return () => (console.warn = warn);
};

test("a page whose tab was refused opens again on the next reload, once, and tells its listeners it is ready", async () => {
  const restore = quietWarnings();
  refuseCreates = 1;
  const events = [];
  const unmount = mountPage("refused-once", { url: "https://a.example/", profile: "incognito:w@", windowId: "w" }, (name) => events.push(name));
  await settle();
  assert.equal(creates("refused-once"), 1);
  assert.deepEqual(events, [], "no ready for a refused page");
  assert.equal(await callPage("refused-once", "stopLoading"), null, "a method that does not reopen answers nothing");
  assert.equal(creates("refused-once"), 1);
  await callPage("refused-once", "reload");
  assert.equal(creates("refused-once"), 2, "the reload tried tab.create again");
  assert.deepEqual(events, ["ready"]);
  assert.deepEqual(calls.at(-1), { verb: "tab.call", args: { key: "refused-once", method: "reload" }, windowId: "" });
  const retried = calls.filter((call) => call.verb === "tab.create" && call.args.key === "refused-once").at(-1);
  assert.deepEqual(retried.args, { key: "refused-once", url: "https://a.example/", profile: "incognito:w@", adopt: "" });
  await callPage("refused-once", "loadUrl", { url: "https://b.example/" });
  assert.equal(creates("refused-once"), 2, "an open page is not opened again");
  unmount();
  restore();
});

test("a second mount while a retry is in flight waits for it and makes no second tab", async () => {
  const restore = quietWarnings();
  refuseCreates = 1;
  const first = [];
  const second = [];
  const unmountFirst = mountPage("in-flight", { url: "https://c.example/", windowId: "w" }, (name) => first.push(name));
  await settle();
  let open;
  createGate = new Promise((resolve) => (open = resolve));
  const loading = callPage("in-flight", "loadUrl", { url: "https://d.example/" });
  const unmountSecond = mountPage("in-flight", { url: "https://c.example/", windowId: "w" }, (name) => second.push(name));
  createGate = null;
  open();
  await loading;
  await settle();
  assert.equal(creates("in-flight"), 2, "one refused create and one retry, nothing more");
  assert.ok(first.includes("ready"));
  assert.ok(second.includes("ready"));
  unmountFirst();
  unmountSecond();
  restore();
});

test("a retry that is refused again reports a load error and stops, and a closed page is never reopened", async () => {
  const restore = quietWarnings();
  refuseCreates = 2;
  const events = [];
  const unmount = mountPage("refused-twice", { url: "https://e.example/", windowId: "w" }, (name, data) => events.push([name, data]));
  await settle();
  assert.equal(await callPage("refused-twice", "loadUrl", { url: "https://f.example/" }), null);
  assert.equal(creates("refused-twice"), 2, "one retry for one call");
  assert.deepEqual(events, [["loadError", { url: "https://f.example/", code: 0, text: "the page could not open" }]]);
  await settle();
  assert.equal(creates("refused-twice"), 2, "no retry loop");
  unmount();
  releasePage("refused-twice");
  assert.equal(await callPage("refused-twice", "reload"), null);
  assert.equal(creates("refused-twice"), 2, "nothing reopens a closed page");
  restore();
});

test("an open private window keeps its session with a hidden blank tab of its own, closed when the window goes", async () => {
  const before = calls.length;
  const release = holdPrivateSession("incognito:w9@work", "w9");
  await settle();
  assert.deepEqual(calls.slice(before), [{ verb: "tab.create", args: { key: "private-window:w9:incognito:w9@work", url: "", profile: "incognito:w9@work" }, windowId: "w9" }]);
  release();
  await settle();
  assert.deepEqual(calls.at(-1), { verb: "tab.close", args: { key: "private-window:w9:incognito:w9@work" }, windowId: "" });
  const quiet = calls.length;
  holdPrivateSession("work", "w9")();
  holdPrivateSession("incognito:w10@work", "")();
  await settle();
  assert.equal(calls.length, quiet, "a regular profile, or a window with no id, holds nothing");
});

test("a closed private window releases its name itself when the app's release never comes, with the releases it held", async () => {
  const pending = [];
  const later = (run) => pending.push(run);
  const closeFirst = privateWindowShown("incognito:lost-a@lost", later);
  const closeLast = privateWindowShown("incognito:lost-b@lost", later);
  const sent = [];
  closeFirst();
  await releaseProfile("incognito:lost-a@lost", async (name) => sent.push(name));
  assert.deepEqual(sent, [], "held while the other private window is open");
  const before = calls.length;
  closeLast();
  assert.equal(calls.length, before, "nothing goes before the delay");
  for (const run of pending.splice(0)) run();
  await settle();
  assert.deepEqual(
    calls.slice(before).map((call) => [call.verb, call.args.profile]),
    [
      ["profile.release", "incognito:lost-a@lost"],
      ["profile.release", "incognito:lost-b@lost"],
    ],
  );
  await releaseProfile("incognito:lost-b@lost", async (name) => sent.push(name));
  assert.deepEqual(sent, [], "the app's late release of the same window sends nothing more");
});

test("a private window's view that unmounts and shows again within the delay releases nothing", async () => {
  const pending = [];
  const closeOnce = privateWindowShown("incognito:remount@again", (run) => pending.push(run));
  closeOnce();
  const closeAgain = privateWindowShown("incognito:remount@again", (run) => pending.push(run));
  const before = calls.length;
  for (const run of pending.splice(0)) run();
  await settle();
  assert.equal(calls.length, before);
  closeAgain();
});
