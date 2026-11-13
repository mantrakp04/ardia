import assert from "node:assert/strict";
import test from "node:test";
import { watchHistoryImports } from "./hostHistoryImports.ts";

function fixture() {
  const listeners = new Set();
  const host = { onEvent: (listener) => { listeners.add(listener); return () => listeners.delete(listener); } };
  const emit = (module, event, payload) => { for (const listener of [...listeners]) listener(module, event, payload); };
  const reloads = [];
  return { host, emit, reloads, listeners, reload: () => { reloads.push(true); return Promise.resolve(); } };
}

test("a history import in another window makes this window read history again", () => {
  const f = fixture();
  watchHistoryImports(f.host, f.reload);
  f.emit("ArdiaHistory", "history", { name: "history.imported", data: { profile: "" } });
  assert.equal(f.reloads.length, 1);
  f.emit("ArdiaHistory", "history", { name: "history.imported", data: { profile: "work" } });
  assert.equal(f.reloads.length, 2);
});

test("ordinary history changes, other modules and junk don't trigger a read", () => {
  const f = fixture();
  watchHistoryImports(f.host, f.reload);
  f.emit("ArdiaHistory", "history", { name: "history.changed", data: { profile: "", kind: "batch", changes: [] } });
  f.emit("ArdiaBookmarks", "bookmarks", { name: "history.imported", data: { profile: "" } });
  f.emit("ArdiaHistory", "other", { name: "history.imported", data: {} });
  f.emit("ArdiaHistory", "history", null);
  f.emit("ArdiaHistory", "history", "history.imported");
  assert.equal(f.reloads.length, 0);
});

test("stopping unsubscribes from the host", () => {
  const f = fixture();
  const stop = watchHistoryImports(f.host, f.reload);
  stop();
  assert.equal(f.listeners.size, 0);
  f.emit("ArdiaHistory", "history", { name: "history.imported", data: { profile: "" } });
  assert.equal(f.reloads.length, 0);
});
