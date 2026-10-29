import assert from "node:assert/strict";
import test from "node:test";
import { mergeDownloadSnapshot, nativeDownloadId, snapshotDownload, startHostDownloads } from "./hostDownloads.ts";
import { initialHostSession } from "./hostSession.ts";
import { useBrowser } from "../../browser/src/state/browser/store.ts";
import { watchNewDownloads } from "../../browser/src/state/windows/downloadWatch.ts";

const ID = (n) => `3f2504e0-4f89-41d3-9a0c-${String(n).padStart(12, "0")}`;
const download = (n, patch = {}) => ({
  id: ID(n), url: `https://example.test/${n}`, filename: `${n}.zip`, path: `/home/me/Downloads/${n}.zip`, state: "finished",
  paused: false, received: 10, total: 10, speed: 0, mimeType: "application/zip", ...patch,
});

function fixture(list = [], capabilities = []) {
  const listeners = new Set();
  const calls = [];
  const replies = new Map([["downloads.list", JSON.stringify(list)]]);
  const host = {
    bootstrap: { windowId: "main", profileId: "default", capabilities },
    call: async (name, profile, args) => {
      calls.push({ name, profile, args: JSON.parse(args) });
      const reply = replies.get(name);
      if (reply instanceof Error) throw reply;
      return reply ?? "null";
    },
    invoke: async (method, args) => method === "ArdiaSystem.fileStatus" ? args.args[0].map(() => true) : null,
    onEvent: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
  };
  const state = {
    downloads: [],
    removeDownload(id) { state.downloads = state.downloads.filter((d) => d.id !== id); },
    clearDownloads() { state.downloads = state.downloads.filter((d) => d.state === "downloading"); },
  };
  const store = { getState: () => state, setState: (patch) => Object.assign(state, patch) };
  const emit = (module, event, payload) => { for (const listener of [...listeners]) listener(module, event, payload); };
  return { host, store, state, calls, replies, emit };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("only Chromium download GUIDs are native download ids", () => {
  assert.equal(nativeDownloadId(ID(1)), true);
  assert.equal(nativeDownloadId(ID(1).toUpperCase()), true);
  for (const id of ["saved-0", "", `${ID(1)}x`, "wk-download-1", 7, null]) assert.equal(nativeDownloadId(id), false);
});

test("snapshot entries are validated, never off the record and always the regular profile", () => {
  assert.deepEqual(snapshotDownload({ ...download(1), profile: "/home/me/.config/ardia/Default" }), { ...download(1), profile: "" });
  for (const bad of [null, "x", { ...download(1), id: "saved-1" }, { ...download(1), state: "paused" }, { ...download(1), offTheRecord: true },
    { ...download(1), received: "10" }, { ...download(1), path: null }, { ...download(1), paused: "no" }]) {
    assert.equal(snapshotDownload(bad), null);
  }
});

test("the startup snapshot fills the list once, newest first, after live entries and within the cap", () => {
  const live = download(9, { state: "downloading", received: 1 });
  const merged = mergeDownloadSnapshot([live], [download(9), download(3), download(2), { bad: true }, download(3)]);
  assert.deepEqual(merged.map((d) => d.id), [ID(9), ID(3), ID(2)]);
  assert.equal(merged[0], live);
  assert.equal(mergeDownloadSnapshot(merged, [download(3)]), null);
  assert.equal(mergeDownloadSnapshot([], { downloads: [] }), null);
  const many = Array.from({ length: 120 }, (_, n) => download(n));
  assert.equal(mergeDownloadSnapshot([], many).length, 100);
  assert.equal(mergeDownloadSnapshot(many.slice(0, 100), [download(500)]), null);
});

test("startup lists downloads through the regular profile without opening the popover path", async () => {
  const f = fixture([download(2), download(1)]);
  const running = startHostDownloads(f.host, f.store);
  await running.ready;
  assert.deepEqual(f.calls, [{ name: "downloads.list", profile: "default", args: {} }]);
  assert.deepEqual(f.state.downloads.map((d) => d.id), [ID(2), ID(1)]);
  running.stop();
});

test("removing a finished or failed download removes exactly that entry from Chromium history", async () => {
  const f = fixture();
  const running = startHostDownloads(f.host, f.store);
  await running.ready;
  f.state.downloads = [download(1), download(5, { state: "failed" }), download(2, { state: "downloading" }), { ...download(4), id: "saved-4" }];
  f.state.removeDownload(ID(1));
  f.state.removeDownload(ID(5));
  f.state.removeDownload(ID(2));
  f.state.removeDownload("saved-4");
  await settle();
  assert.deepEqual(f.calls.slice(1), [
    { name: "downloads.remove", profile: "default", args: { id: ID(1) } },
    { name: "downloads.remove", profile: "default", args: { id: ID(5) } },
  ]);
  running.stop();
});

test("Clear removes every finished download the engine knows, including history the list never showed", async () => {
  const f = fixture();
  const running = startHostDownloads(f.host, f.store);
  await running.ready;
  f.state.downloads = [download(1), download(2, { state: "downloading" }), download(3, { state: "cancelled" }), download(4, { state: "failed" })];
  const before = Date.now();
  f.state.clearDownloads("main");
  await settle();
  assert.deepEqual(f.state.downloads.map((d) => d.id), [ID(2)]);
  const clears = f.calls.filter((c) => c.name === "downloads.clear");
  assert.equal(clears.length, 1);
  assert.deepEqual(clears[0].args.keep, [ID(2)]);
  assert.ok(clears[0].args.before >= before && clears[0].args.before <= Date.now());
  assert.equal(f.calls.filter((c) => c.name === "downloads.remove").length, 0);
  running.stop();
});

function focusedStore(host) {
  useBrowser.getState().hydrate(initialHostSession(host, null));
  useBrowser.setState((s) => ({ downloads: [], ui: { ...s.ui, focusOrder: ["main"] } }));
  return useBrowser;
}

test("startup never deletes history, and an older entry surfacing after a single removal is not announced", async () => {
  let history = Array.from({ length: 150 }, (_, n) => download(150 - n));
  const first = fixture(history);
  const store = focusedStore(first.host);
  const fresh = [];
  let stopWatch = watchNewDownloads("main", (d) => fresh.push(d.id));
  let running = startHostDownloads(first.host, store);
  await running.ready;
  await settle();
  assert.equal(store.getState().downloads.length, 100);
  assert.equal(store.getState().downloads[0].id, ID(150));
  assert.deepEqual(first.calls.map((c) => c.name), ["downloads.list"]);
  store.getState().removeDownload(ID(150));
  await settle();
  assert.deepEqual(first.calls.slice(1), [{ name: "downloads.remove", profile: "default", args: { id: ID(150) } }]);
  assert.equal(store.getState().downloads.length, 99);
  stopWatch();
  running.stop();

  history = history.filter((d) => d.id !== ID(150));
  const restarted = fixture(history);
  focusedStore(restarted.host);
  stopWatch = watchNewDownloads("main", (d) => fresh.push(d.id));
  running = startHostDownloads(restarted.host, store);
  await running.ready;
  await settle();
  const shown = store.getState().downloads.map((d) => d.id);
  assert.equal(shown.length, 100);
  assert.equal(shown.at(-1), ID(50));
  assert.deepEqual(restarted.calls.map((c) => c.name), ["downloads.list"]);
  assert.deepEqual(fresh, []);
  stopWatch();
  running.stop();
});

test("removals seen while the startup list is in flight are not undone by its reply", async () => {
  const f = fixture();
  let reply;
  f.host.call = (name, profile, args) => {
    f.calls.push({ name, profile, args: JSON.parse(args) });
    if (name === "downloads.list") return new Promise((resolve) => (reply = resolve));
    return Promise.resolve("null");
  };
  f.state.downloads = [download(3)];
  const running = startHostDownloads(f.host, f.store);
  await settle();
  f.emit("ArdiaDownloads", "downloads", { name: "downloads.removed", data: { id: ID(1), profile: "" } });
  f.state.removeDownload(ID(3));
  reply(JSON.stringify([download(3), download(2), download(1)]));
  await running.ready;
  assert.deepEqual(f.state.downloads.map((d) => d.id), [ID(2)]);
  running.stop();
});

test("the startup snapshot never announces itself as a new download in the focused window", async () => {
  const f = fixture([download(2), download(1)]);
  focusedStore(f.host);
  const fresh = [];
  const stopWatch = watchNewDownloads("main", (d) => fresh.push(d.id));
  const running = startHostDownloads(f.host, useBrowser);
  await running.ready;
  assert.deepEqual(useBrowser.getState().downloads.map((d) => d.id), [ID(2), ID(1)]);
  assert.ok(useBrowser.getState().downloads.every((d) => d.profile === ""));
  assert.deepEqual(fresh, []);
  useBrowser.getState().upsertDownload(download(3, { state: "downloading" }));
  assert.deepEqual(fresh, [ID(3)]);
  stopWatch();
  running.stop();
});

test("removal events from another window update this list without echoing a native remove", async () => {
  const f = fixture([download(1), download(2)]);
  const running = startHostDownloads(f.host, f.store);
  await running.ready;
  f.emit("ArdiaDownloads", "downloads", { name: "downloads.removed", data: { id: ID(1), profile: "" } });
  f.emit("ArdiaDownloads", "downloads", { name: "downloads.removed", data: { id: "saved-2" } });
  f.emit("ArdiaTabs", "downloads", { name: "downloads.removed", data: { id: ID(2) } });
  f.emit("ArdiaDownloads", "downloads", { name: "downloads.changed", data: { id: ID(2) } });
  await settle();
  assert.deepEqual(f.state.downloads.map((d) => d.id), [ID(2)]);
  assert.equal(f.calls.filter((c) => c.name === "downloads.remove").length, 0);
  running.stop();
});

test("a failed snapshot is reported and leaves live entries alone; stop restores the shared actions", async () => {
  const f = fixture();
  const { removeDownload, clearDownloads } = f.state;
  f.replies.set("downloads.list", Object.assign(new Error("This call is unavailable on Linux"), { code: "ERR_UNKNOWN_CALL" }));
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args);
  try {
    f.state.downloads = [download(7, { state: "downloading" })];
    const running = startHostDownloads(f.host, f.store);
    await running.ready;
    assert.equal(errors.length, 1);
    assert.deepEqual(f.state.downloads.map((d) => d.id), [ID(7)]);
    running.stop();
    assert.equal(f.state.removeDownload, removeDownload);
    assert.equal(f.state.clearDownloads, clearDownloads);
  } finally {
    console.error = original;
  }
});

test("a private window lists only its own off-the-record downloads, labelled with their original profile", async () => {
  const f = fixture([download(3, { offTheRecord: true }), download(2, { offTheRecord: false }), download(1, { offTheRecord: true })]);
  f.host.bootstrap = { ...f.host.bootstrap, windowId: "p1", pageProfile: "incognito:p1@" };
  const running = startHostDownloads(f.host, f.store);
  await running.ready;
  assert.deepEqual(f.calls, [{ name: "downloads.list", profile: "default", args: {} }]);
  assert.deepEqual(f.state.downloads.map((d) => [d.id, d.profile, d.offTheRecord]), [[ID(3), "", true], [ID(1), "", true]]);
  running.stop();
});

test("a private window of an isolated profile labels its downloads with that profile's private session", async () => {
  const f = fixture([download(4, { offTheRecord: true })]);
  f.host.bootstrap = { ...f.host.bootstrap, windowId: "p2", pageProfile: "incognito:p2@work" };
  const running = startHostDownloads(f.host, f.store);
  await running.ready;
  assert.deepEqual(f.state.downloads.map((d) => [d.id, d.profile, d.offTheRecord]), [[ID(4), "work", true]]);
  running.stop();
});

test("a regular window never lists off-the-record downloads", async () => {
  const f = fixture([download(3, { offTheRecord: true }), download(2, { offTheRecord: false })]);
  const running = startHostDownloads(f.host, f.store);
  await running.ready;
  assert.deepEqual(f.state.downloads.map((d) => d.id), [ID(2)]);
  running.stop();
});

test("off-the-record snapshot entries are accepted only when asked for", () => {
  assert.equal(snapshotDownload({ ...download(1), offTheRecord: true }), null);
  assert.deepEqual(snapshotDownload({ ...download(1), offTheRecord: true }, true), { ...download(1), offTheRecord: true, profile: "" });
  assert.equal(snapshotDownload(download(1), true), null);
  assert.equal(snapshotDownload({ ...download(1), offTheRecord: false }, true), null);
});

test("a download that finishes, or arrives finished in the startup list, never renders as missing first", async () => {
  const { hostFiles } = await import("./hostFiles.ts");
  const f = fixture([download(4)], ["ArdiaSystem.fileStatus"]);
  const files = hostFiles(f.host);
  const started = startHostDownloads(f.host, f.store);
  await started.ready;
  assert.equal(files.fileExists(download(4).path), true);
  f.emit("ArdiaDownloads", "downloads", { name: "downloads.changed", data: download(5) });
  assert.equal(files.fileExists(download(5).path), true);
  f.emit("ArdiaDownloads", "downloads", { name: "downloads.changed", data: download(6, { state: "downloading", received: 1 }) });
  assert.equal(files.fileExists(download(6).path), false);
  started.stop();
});
