import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const model = await import("../browser/model.ts");
const { useCli, useCliIndicator } = await import("../app/cliControl.ts");
const { startAutomation } = await import("./controlSocket.ts");
const { noteCommit } = await import("./automationEvents.ts");
const { automationWindows } = await import("./automationWindows.ts");
const stub = await import("../../test-native/index.ts");

const S = () => useBrowser.getState();
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
let nextId = 0;
let nextConnection = 100;

async function controlOn() {
  S().updateSettings({ cliControl: true });
  startAutomation();
  for (let i = 0; i < 5 && !stub.controlSocket.running; i++) await tick();
  await tick();
}

function call(method, params, { connection = 1, generation = stub.controlSocket.generation, raw } = {}) {
  const id = ++nextId;
  const before = stub.controlSocket.replies.length;
  stub.emitControlRequest({ connection, generation, line: raw ?? JSON.stringify({ id, method, params }) });
  const replies = stub.controlSocket.replies.slice(before).filter((r) => r.connection === connection);
  assert.equal(replies.length, 1, `one reply to ${method}`);
  return JSON.parse(replies[0].line);
}

function eventsFor(connection, from) {
  return stub.controlSocket.broadcasts.slice(from).filter((b) => b.connections.includes(connection)).map((b) => JSON.parse(b.line));
}

function fresh() {
  S().hydrate({});
  S().updateSettings({ cliControl: true });
}

test("hello, unknown methods and malformed lines", async () => {
  fresh();
  await controlOn();
  assert.deepEqual(call("hello").result, { app: "Ardia", version: "1.0", protocol: 1 });
  const unknown = call("dance");
  assert.equal(unknown.error.code, "unknown_method");
  const bad = call(null, null, { raw: "not json" });
  assert.deepEqual([bad.id, bad.error.code], [null, "bad_request"]);
  const noId = call(null, null, { raw: JSON.stringify({ method: "hello" }) });
  assert.deepEqual([noId.id, noId.error.code], [null, "bad_request"]);
  const blank = call(null, null, { raw: "" });
  assert.deepEqual([blank.id, blank.error.code], [null, "bad_request"]);
  const array = call(null, null, { raw: "[1]" });
  assert.equal(array.id, null);
  const stringId = call(null, null, { raw: JSON.stringify({ id: "a", method: "hello" }) });
  assert.equal(stringId.id, "a");
});

test("run refuses what isn't automatable and accepts only catalog ids", async () => {
  fresh();
  await controlOn();
  S().createWindow({ url: "https://a.example/" });
  assert.equal(call("run", { command: "std:quit:" }).error.code, "unknown_command");
  assert.equal(call("run", { command: "quit" }).error.code, "unknown_command");
  assert.equal(call("run", { command: "togglePageEngine" }).error.code, "refused");
  assert.equal(call("run", { command: "toggleJavaScriptFromAppleEvents" }).error.code, "refused");
  assert.equal(S().settings.allowJavaScriptFromAppleEvents, false);
  assert.equal(call("run", { command: "switchProfile", arg: "x" }).error.code, "refused");
  assert.equal(call("run", { command: "setAppearance", arg: "purple" }).error.code, "bad_request");
  assert.equal(call("run", {}).error.code, "bad_request");
  assert.deepEqual(call("run", { command: "setAppearance", arg: "dark" }).result, { ok: true });
  assert.equal(S().settings.appearance, "dark");
});

test("run targets an eligible window and never falls back", async () => {
  fresh();
  await controlOn();
  const priv = S().createWindow({ kind: "private", url: "https://secret.example/" });
  assert.equal(call("run", { command: "nextTab" }).error.code, "no_window");
  const w = S().createWindow({ url: "https://a.example/" });
  const second = S().newTab(w, { url: "https://b.example/" });
  S().activate(model.viewTabIds(S(), w)[0]);
  assert.equal(call("run", { command: "nextTab", window: priv }).error.code, "no_window");
  assert.equal(call("run", { command: "nextTab", window: "nope" }).error.code, "no_window");
  assert.equal(model.activeTabId(S(), w), model.viewTabIds(S(), w)[0]);
  assert.deepEqual(call("run", { command: "nextTab", window: w }).result, { ok: true });
  assert.equal(model.activeTabId(S(), w), second);
  S().setFocusedWindow(priv);
  assert.deepEqual(call("run", { command: "previousTab" }).result, { ok: true });
  assert.notEqual(model.activeTabId(S(), w), second);
});

test("a request tagged with an old generation, or arriving after Stop, never runs", async () => {
  fresh();
  await controlOn();
  const w = S().createWindow({ url: "https://a.example/" });
  S().newTab(w, { url: "https://b.example/" });
  S().activate(model.viewTabIds(S(), w)[0]);
  const before = model.activeTabId(S(), w);
  const stale = call("run", { command: "nextTab", window: w }, { generation: stub.controlSocket.generation - 1 });
  assert.equal(stale.error.code, "failed");
  S().updateSettings({ cliControl: false });
  const off = call("run", { command: "nextTab", window: w });
  assert.equal(off.error.code, "failed");
  assert.equal(model.activeTabId(S(), w), before);
  await tick();
  await tick();
  assert.equal(stub.controlSocket.running, false);
});

test("windows lists normal and Little Ardia windows, never private ones, and redacts internal pages", async () => {
  fresh();
  await controlOn();
  const w = S().createWindow({ url: "https://a.example/" });
  S().newTab(w, { url: "ardia://history?q=secret#frag" });
  S().createWindow({ kind: "private", url: "https://secret.example/" });
  const little = S().createWindow({ kind: "small", url: "https://c.example/" });
  const listed = call("windows").result;
  assert.deepEqual(listed.map((x) => [x.id, x.kind]).sort(), [[w, "normal"], [little, "little"]].sort());
  const main = listed.find((x) => x.id === w);
  assert.equal(main.profile, S().windows[w].profileId);
  assert.equal(typeof main.profileName, "string");
  const history = main.tabs.find((t) => t.url.startsWith("ardia://history"));
  assert.deepEqual([history.url, history.title], ["ardia://history", "History"]);
  assert.equal(main.tabs.filter((t) => t.active).length, 1);
  for (const t of main.tabs) assert.deepEqual(Object.keys(t).sort(), ["active", "group", "id", "pinned", "profile", "title", "url"]);
  assert.ok(!JSON.stringify(listed).includes("secret"));
});

test("a Peek tab isn't part of its window's tabs", () => {
  fresh();
  const w = S().createWindow({ url: "https://a.example/" });
  const source = model.activeTabId(S(), w);
  const peek = S().openPeek(source, "https://peek.example/");
  const listed = automationWindows(S()).find((x) => x.id === w);
  assert.ok(!listed.tabs.some((t) => t.id === peek));
});

test("events: shapes, private windows left out, closes from the previous snapshot, subscribe replacement", async () => {
  fresh();
  await controlOn();
  const connection = ++nextConnection;
  const from = stub.controlSocket.broadcasts.length;
  assert.deepEqual(call("subscribe", { events: ["*"] }, { connection }).result, { ok: true });
  const w = S().createWindow({ url: "https://a.example/" });
  const t = S().newTab(w, { url: "https://b.example/" });
  S().activate(t);
  const priv = S().createWindow({ kind: "private", url: "https://secret.example/" });
  S().newTab(priv, { url: "https://secret2.example/" });
  S().closeTab(t);
  const events = eventsFor(connection, from);
  assert.ok(!JSON.stringify(events).includes("secret"));
  assert.ok(!JSON.stringify(events).includes(priv));
  const opened = events.find((e) => e.event === "window.opened");
  assert.deepEqual(opened.data, { windowId: w, kind: "normal", profile: S().windows[w].profileId });
  const tabOpened = events.find((e) => e.event === "tab.opened" && e.data.tabId === t);
  assert.deepEqual(Object.keys(tabOpened.data).sort(), ["profile", "tabId", "title", "url", "windowId"]);
  assert.equal(tabOpened.data.url, "https://b.example/");
  assert.equal(typeof tabOpened.time, "number");
  assert.ok(events.some((e) => e.event === "tab.activated" && e.data.tabId === t));
  assert.ok(events.some((e) => e.event === "tab.closed" && e.data.tabId === t && e.data.url === "https://b.example/"));

  const replaced = stub.controlSocket.broadcasts.length;
  call("subscribe", { events: ["window.opened"] }, { connection });
  const w2 = S().createWindow({ url: "https://d.example/" });
  const after = eventsFor(connection, replaced);
  assert.deepEqual(after.map((e) => e.event), ["window.opened"]);
  assert.equal(after[0].data.windowId, w2);
  assert.equal(call("subscribe", { events: ["nope"] }, { connection }).error.code, "bad_request");

  stub.emitControlClose(connection);
  const closed = stub.controlSocket.broadcasts.length;
  S().createWindow({ url: "https://e.example/" });
  assert.equal(stub.controlSocket.broadcasts.length, closed);
});

test("tab.navigated comes from commits only, with sameDocument for in-page changes", async () => {
  fresh();
  await controlOn();
  const connection = ++nextConnection;
  call("subscribe", { events: ["tab.navigated"] }, { connection });
  const w = S().createWindow({ url: "https://a.example/" });
  const t = model.activeTabId(S(), w);
  const from = stub.controlSocket.broadcasts.length;
  S().updateTab(t, { url: "https://pending.example/" });
  assert.equal(eventsFor(connection, from).length, 0);
  const at = Date.now() + 1000;
  noteCommit(t, "https://a.example/page", at);
  noteCommit(t, "https://a.example/page", at);
  noteCommit(t, "https://a.example/page#two", at);
  await new Promise((resolve) => setTimeout(resolve, 150));
  noteCommit(t, "https://a.example/page#three", at);
  noteCommit(t, "https://a.example/page#three", at + 1);
  const priv = S().createWindow({ kind: "private", url: "https://secret.example/" });
  noteCommit(model.activeTabId(S(), priv), "https://secret.example/x", at + 2);
  noteCommit(model.activeTabId(S(), priv), "https://secret.example/y", at + 2);
  await new Promise((resolve) => setTimeout(resolve, 150));
  const events = eventsFor(connection, from);
  assert.deepEqual(events.map((e) => [e.data.url, e.data.sameDocument]), [
    ["https://a.example/page", false],
    ["https://a.example/page#two", true],
    ["https://a.example/page#three", false],
  ]);
  assert.deepEqual(Object.keys(events[0].data).sort(), ["profile", "sameDocument", "tabId", "title", "url", "windowId"]);
});

test("run shows the pill and the other methods don't", async () => {
  fresh();
  await controlOn();
  S().createWindow({ url: "https://a.example/" });
  useCli.setState({ server: { state: "on", connections: 0, generation: 1, file: "" } });
  useCliIndicator.setState({ shown: false });
  call("windows");
  call("hello");
  assert.equal(useCliIndicator.getState().shown, false);
  call("run", { command: "setAppearance", arg: "light" });
  assert.equal(useCliIndicator.getState().shown, true);
  S().updateSettings({ cliControl: false });
  assert.equal(useCliIndicator.getState().shown, true);
  useCli.setState({ server: { state: "off", connections: 0, generation: 2, file: "" } });
  assert.equal(useCliIndicator.getState().shown, false);
});

test("the pill shows for a socket run while CDP is external, and Stop hides it at once", async () => {
  fresh();
  await controlOn();
  S().createWindow({ url: "https://a.example/" });
  useCli.setState({ server: { state: "external", connections: 0, generation: 3, file: "" } });
  useCliIndicator.setState({ shown: false });
  call("run", { command: "setAppearance", arg: "dark" });
  assert.equal(useCliIndicator.getState().shown, true);
  S().updateSettings({ cliControl: false });
  assert.equal(useCliIndicator.getState().shown, false);
});

test("a Little Ardia target never falls back to a private window", async () => {
  fresh();
  await controlOn();
  const priv = S().createWindow({ kind: "private", url: "https://secret.example/" });
  S().newTab(priv, { url: "https://secret2.example/" });
  const little = S().createWindow({ kind: "small", url: "https://c.example/" });
  S().setFocusedWindow(priv);
  const before = model.activeTabId(S(), priv);
  assert.equal(call("run", { command: "nextTab", window: little }).error.code, "no_window");
  assert.equal(call("run", { command: "nextTab" }).error.code, "no_window");
  assert.equal(model.activeTabId(S(), priv), before);
  const main = S().createWindow({ url: "https://a.example/" });
  S().newTab(main, { url: "https://b.example/" });
  S().setFocusedWindow(priv);
  const mainBefore = model.activeTabId(S(), main);
  assert.deepEqual(call("run", { command: "nextTab", window: little }).result, { ok: true });
  assert.equal(model.activeTabId(S(), priv), before);
  assert.notEqual(model.activeTabId(S(), main), mainBefore);
});

test("same-document navigations in quick succession all arrive, in order", async () => {
  fresh();
  await controlOn();
  const connection = ++nextConnection;
  call("subscribe", { events: ["tab.navigated"] }, { connection });
  const w = S().createWindow({ url: "https://a.example/" });
  const t = model.activeTabId(S(), w);
  const from = stub.controlSocket.broadcasts.length;
  const at = Date.now() + 1000;
  noteCommit(t, "https://a.example/", at);
  noteCommit(t, "https://a.example/#one", at);
  noteCommit(t, "https://a.example/#two", at);
  noteCommit(t, "https://a.example/next", at);
  noteCommit(t, "https://a.example/next", at + 1);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.deepEqual(eventsFor(connection, from).map((e) => [e.data.url, e.data.sameDocument]), [
    ["https://a.example/", false],
    ["https://a.example/#one", true],
    ["https://a.example/#two", true],
    ["https://a.example/next", false],
  ]);
});

test("the pill stays up until the run's reply is written", async () => {
  fresh();
  await controlOn();
  S().createWindow({ url: "https://a.example/" });
  useCli.setState({ server: { state: "external", connections: 0, generation: 4, file: "" } });
  useCliIndicator.setState({ shown: false });
  stub.controlSocket.holdWrites = true;
  call("run", { command: "setAppearance", arg: "light" });
  await new Promise((resolve) => setTimeout(resolve, 3200));
  assert.equal(useCliIndicator.getState().shown, true);
  stub.controlSocket.holdWrites = false;
  stub.writeHeldReplies();
  await new Promise((resolve) => setTimeout(resolve, 3200));
  assert.equal(useCliIndicator.getState().shown, false);
  S().updateSettings({ cliControl: false });
});
