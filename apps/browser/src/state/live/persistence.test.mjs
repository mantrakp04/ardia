import assert from "node:assert/strict";
import test from "node:test";
import { docs } from "../../test-native/index.ts";
import { updateCalendarSettings, live, setLive } from "./store.ts";

test("default persistence keeps its 800ms debounce and versioned projection", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  docs.delete("live.json");
  setLive({ status: { f: { state: "updating" } }, completing: { f: ["i"] }, showAll: { f: true } });
  updateCalendarSettings({ showPreview: false });
  assert.equal(docs.has("live.json"), false);
  context.mock.timers.tick(799);
  assert.equal(docs.has("live.json"), false);
  updateCalendarSettings({ showTimeToNext: false });
  context.mock.timers.tick(799);
  assert.equal(docs.has("live.json"), false);
  context.mock.timers.tick(1);
  const saved = JSON.parse(docs.get("live.json"));
  assert.equal(saved.version, 1);
  assert.equal(saved.calendar.showPreview, false);
  assert.equal(saved.calendar.showTimeToNext, false);
  for (const key of ["status", "completing", "showAll"]) assert.equal(key in saved, false);
  assert.equal(live().showAll.f, true);
});

test("default engine keeps its completion animation timer and ordinary saved cleanup", async (context) => {
  const { refreshFolder, COMPLETION_MS } = await import("./engine.ts");
  const { SOURCES } = await import("./sources.ts");
  const { applyFetch, createFolder } = await import("./store.ts");
  const previousFetch = SOURCES.github.fetch, previousGone = SOURCES.github.resolveGone;
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const item = { id: "default-item", source: "github", url: "https://example.test/item", title: "Item", subtitle: "", icon: null, updatedAt: 0 };
  SOURCES.github.fetch = async () => [];
  SOURCES.github.resolveGone = async () => ({ "default-item": "closed" });
  try {
    const id = createFolder("p", "pullRequests", ["github"]);
    applyFetch(id, [item], {});
    await refreshFolder(id);
    assert.deepEqual(live().completing[id], ["default-item"]);
    context.mock.timers.tick(COMPLETION_MS - 1);
    assert.deepEqual(live().items[id].map((entry) => entry.id), ["default-item"]);
    context.mock.timers.tick(1);
    assert.deepEqual(live().items[id], []);
    assert.equal(live().completed[id][0].item.id, "default-item");
    context.mock.timers.tick(800);
    assert.deepEqual(JSON.parse(docs.get("live.json")).items[id], []);
  } finally { SOURCES.github.fetch = previousFetch; SOURCES.github.resolveGone = previousGone; }
});
