import assert from "node:assert/strict";
import test from "node:test";
import { privateWindowEntries, watchHostPrivateWindows } from "./hostPrivateWindows.ts";

const settle = () => new Promise(setImmediate);

function fixture(replies) {
  const listeners = new Set();
  const invoked = [];
  const host = {
    bootstrap: { windowId: "main", profileId: "default", capabilities: [] },
    invoke: async (method, args) => {
      invoked.push([method, args]);
      if (method === "ArdiaShell.privateWindows") {
        const reply = replies.shift();
        if (reply instanceof Error) throw reply;
        return reply;
      }
      return null;
    },
    onEvent: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
  };
  const emit = (module, event, payload = {}) => { for (const listener of [...listeners]) listener(module, event, payload); };
  return { host, invoked, emit, listeners };
}

test("directory entries keep only well-formed ids of other windows and carry no page data", () => {
  const entries = privateWindowEntries([{ id: "w-p1", title: "Bank", url: "https://bank.test/" }, { id: "main" }, { id: "w-p1" }, { id: "../x" }, { id: 7 }, null, { id: "w-p2" }], "main");
  assert.deepEqual(entries, [{ id: "w-p1", title: "Private Window" }, { id: "w-p2", title: "Private Window 2" }]);
  assert.deepEqual(privateWindowEntries({ id: "w-p1" }, "main"), []);
});

test("each private window keeps the number the host gave it, so every window labels it the same", () => {
  const all = [{ id: "w-p1", ordinal: 1 }, { id: "w-p3", ordinal: 3 }, { id: "w-p2", ordinal: 2 }];
  const fromFirst = privateWindowEntries(all, "w-p1");
  const fromSecond = privateWindowEntries(all, "w-p2");
  assert.deepEqual(fromFirst, [{ id: "w-p3", title: "Private Window 3" }, { id: "w-p2", title: "Private Window 2" }]);
  assert.deepEqual(fromSecond, [{ id: "w-p1", title: "Private Window" }, { id: "w-p3", title: "Private Window 3" }]);
  assert.deepEqual(privateWindowEntries([{ id: "w-p1", ordinal: 0 }, { id: "w-p2", ordinal: "2" }], "main").map((w) => w.title), ["Private Window", "Private Window 2"]);
});

test("the list refreshes when the native directory changes and selecting focuses that window", async () => {
  const f = fixture([[{ id: "w-p1" }], [{ id: "w-p1" }, { id: "w-p2" }], []]);
  const seen = [];
  const watcher = watchHostPrivateWindows(f.host, (windows) => seen.push(windows.map((w) => w.id)));
  await settle();
  f.emit("ArdiaShell", "onWindowEvent", { type: "focus", id: "main" });
  f.emit("ArdiaShell", "privateWindows");
  await settle();
  await watcher.focus("w-p2");
  f.emit("ArdiaShell", "privateWindows");
  await settle();
  assert.deepEqual(seen, [["w-p1"], ["w-p1", "w-p2"], []]);
  assert.deepEqual(f.invoked.filter(([method]) => method === "ArdiaShell.focusWindow"), [["ArdiaShell.focusWindow", { args: ["w-p2"] }]]);
  watcher.stop();
  assert.equal(f.listeners.size, 0);
});

test("a failed or stale lookup never shows windows from an older answer", async () => {
  let release;
  const slow = new Promise((resolve) => { release = resolve; });
  const f = fixture([slow, [{ id: "w-p3" }], new Error("gone")]);
  const seen = [];
  const watcher = watchHostPrivateWindows(f.host, (windows) => seen.push(windows.map((w) => w.id)));
  f.emit("ArdiaShell", "privateWindows");
  await settle();
  release([{ id: "w-old" }]);
  await settle();
  f.emit("ArdiaShell", "privateWindows");
  await settle();
  assert.deepEqual(seen, [["w-p3"], []]);
  watcher.stop();
  f.emit("ArdiaShell", "privateWindows");
  await settle();
  assert.equal(seen.length, 2);
});
