import assert from "node:assert/strict";
import { test } from "node:test";
import { DeviceEventEmitter, turboModules } from "../test-native/reactNative.ts";

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

const { mountPage, callPage, releasePage, showPage } = await import("../../../../packages/expo-windows/src/engine/pages.ts");
const { holdPrivateSession, privateWindowShown, releaseProfile } = await import("../../../../packages/expo-windows/src/engine/privateWindows.ts");

const emitTopic = (topic, payload) => DeviceEventEmitter.emit("ArdiaEngineHost:event", { topic, json: JSON.stringify(payload) });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const creates = (key) => calls.filter((call) => call.verb === "tab.create" && call.args.key === key).length;
const shows = (key) => calls.filter((call) => call.verb === "tab.show" && call.args.key === key);
const readies = (events) => events.filter((name) => name === "ready").length;
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
  await settle();
  assert.equal(creates("in-flight"), 2, "one refused create and one retry, nothing more");
  assert.equal(readies(first), 1, "the listener mounted before the retry is told ready once");
  assert.equal(readies(second), 1, "the listener mounted during the retry is told ready once");
  unmountFirst();
  unmountSecond();
  restore();
});

test("a page shown while its tab was refused is shown once with that shape when the retry opens it, before ready", async () => {
  const restore = quietWarnings();
  refuseCreates = 1;
  const showsAtReady = [];
  const unmount = mountPage("hidden-retry", { url: "https://g.example/", windowId: "w" }, (name) => {
    if (name === "ready") showsAtReady.push(shows("hidden-retry").length);
  });
  await settle();
  const shape = { x: 10, y: 20, width: 300, height: 200, radius: 8, holes: [] };
  showPage("hidden-retry", true, shape);
  await settle();
  assert.equal(shows("hidden-retry").length, 0, "nothing is shown while the tab is refused");
  await callPage("hidden-retry", "loadUrl", { url: "https://h.example/" });
  await settle();
  await settle();
  assert.equal(creates("hidden-retry"), 2);
  const secondCreate = calls.findLastIndex((call) => call.verb === "tab.create" && call.args.key === "hidden-retry");
  const after = calls.slice(secondCreate).filter((call) => call.verb === "tab.show" && call.args.key === "hidden-retry");
  assert.deepEqual(after, [{ verb: "tab.show", args: { key: "hidden-retry", visible: true, ...shape }, windowId: "w" }]);
  assert.deepEqual(showsAtReady, [1], "the show went before the listeners heard ready");
  showPage("hidden-retry", true, { ...shape, width: 320 });
  await settle();
  assert.equal(shows("hidden-retry").length, 2, "a later show still goes");
  unmount();
  restore();
});

test("a show asked while the retry is in flight goes once", async () => {
  const restore = quietWarnings();
  refuseCreates = 1;
  const unmount = mountPage("show-in-flight", { url: "https://i.example/", windowId: "w" }, () => {});
  await settle();
  let open;
  createGate = new Promise((resolve) => (open = resolve));
  const loading = callPage("show-in-flight", "reload");
  const shape = { x: 0, y: 0, width: 100, height: 100, radius: 0, holes: [] };
  showPage("show-in-flight", true, shape);
  createGate = null;
  open();
  await loading;
  await settle();
  assert.equal(shows("show-in-flight").length, 1);
  unmount();
  restore();
});

test("a page's Peek and a tab it opened from a click reach the page with their points placed in the window", async () => {
  const events = [];
  const unmount = mountPage("peek-source", { url: "https://p.example/", windowId: "w" }, (name, data) => events.push([name, data]));
  await settle();
  showPage("peek-source", true, { x: 100, y: 50, width: 800, height: 600, radius: 0, holes: [] });
  await settle();
  emitTopic("tab", { key: "peek-source", name: "openWindow", data: { url: "https://q.example/", disposition: "peek", userGesture: true, site: false, point: { x: 10, y: 20 } } });
  const opened = (adopt, fromClick) =>
    emitTopic("tab.opened", { adopt, url: "https://r.example/", foreground: true, window: false, opener: "peek-source", profile: "", fromClick, point: { x: 30, y: 40 } });
  opened("ardiacore:7", true);
  opened("ardiacore:8", false);
  const asked = events.filter(([name]) => name === "openWindow").map(([, data]) => data);
  assert.deepEqual(asked[0], { url: "https://q.example/", disposition: "peek", userGesture: true, site: false, point: { x: 110, y: 70 } });
  assert.equal(asked[1].adoptId, "ardiacore:7");
  assert.equal(asked[1].disposition, "foreground");
  assert.equal(asked[1].fromClick, true);
  assert.deepEqual(asked[1].point, { x: 130, y: 90 });
  assert.equal(asked[2].fromClick, false, "a tab the page opened without a click is a plain new tab");
  assert.equal(asked[2].point, undefined);
  showPage("peek-source", false, null);
  await settle();
  emitTopic("tab", { key: "peek-source", name: "openWindow", data: { url: "https://q.example/", disposition: "peek", point: { x: 10, y: 20 } } });
  assert.equal(events.at(-1)[1].point, undefined, "a hidden page has no place in the window to point from");
  unmount();
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
  const made = calls.slice(before);
  assert.equal(made.length, 1);
  assert.match(made[0].args.key, /^private-window:w9:\d+:incognito:w9@work$/);
  assert.deepEqual({ ...made[0], args: { ...made[0].args, key: "" } }, { verb: "tab.create", args: { key: "", url: "", profile: "incognito:w9@work" }, windowId: "w9" });
  release();
  await settle();
  assert.deepEqual(calls.at(-1), { verb: "tab.close", args: { key: made[0].args.key }, windowId: "" });
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

test("a private window's view that unmounts and mounts again in one tick keeps a hidden tab: the old one's close cannot reach the new one", async () => {
  const before = calls.length;
  const releaseFirst = holdPrivateSession("incognito:w11@work", "w11");
  await settle();
  releaseFirst();
  const releaseSecond = holdPrivateSession("incognito:w11@work", "w11");
  await settle();
  const held = calls.slice(before).filter((call) => call.args.profile === "incognito:w11@work" || String(call.args.key).includes("w11"));
  const creates = held.filter((call) => call.verb === "tab.create").map((call) => call.args.key);
  const closes = held.filter((call) => call.verb === "tab.close").map((call) => call.args.key);
  assert.equal(creates.length, 2);
  assert.notEqual(creates[0], creates[1], "each hold has its own tab");
  assert.deepEqual(closes, [creates[0]], "only the first hold's tab closed");
  releaseSecond();
  await settle();
  assert.deepEqual(calls.at(-1), { verb: "tab.close", args: { key: creates[1] }, windowId: "" });
});

test("a page that unmounts and mounts again in one tick under the same key closes its old tab before the new one is made", async () => {
  const unmountFirst = mountPage("moved-profile", { url: "https://a.example/", profile: "p-one", windowId: "w" }, () => {});
  await settle();
  const before = calls.length;
  unmountFirst();
  const unmountSecond = mountPage("moved-profile", { url: "https://a.example/", profile: "p-two", windowId: "w" }, () => {});
  await settle();
  const order = calls.slice(before).filter((call) => call.args.key === "moved-profile" && (call.verb === "tab.close" || call.verb === "tab.create"));
  assert.deepEqual(
    order.map((call) => [call.verb, call.args.profile ?? ""]),
    [
      ["tab.close", ""],
      ["tab.create", "p-two"],
    ],
  );
  unmountSecond();
  await settle();
});
