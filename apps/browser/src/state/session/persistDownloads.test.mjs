import assert from "node:assert/strict";
import { test } from "node:test";
import { docs, removedStagings, stagingRemovals } from "../../test-native/index.ts";
import { flushPersistence, loadSession, startPersistence } from "./persist.ts";
import { useBrowser } from "../browser/store.ts";

const paused = {
  id: "wk-download-1",
  url: "https://a/x",
  filename: "x",
  path: "/d/.ardia-download-1/x",
  state: "failed",
  paused: true,
  received: 1,
  total: 2,
  speed: 0,
  mimeType: "",
  profile: "",
  staging: "/d/.ardia-download-1",
};
const finished = { ...paused, id: "wk-download-2", path: "/d/y", state: "finished", paused: false, staging: null };

function load(downloads, version = 3) {
  docs.set("session.json", JSON.stringify({ version: 2, windows: [], tabs: [] }));
  docs.set("downloads.json", JSON.stringify({ version, downloads }));
  return loadSession();
}

test("a download left paused at quit asks for its staging folder to go, and keeps it named until it has", () => {
  removedStagings.length = 0;
  stagingRemovals.ok = false;
  const data = load([paused, finished]);
  assert.deepEqual(removedStagings, ["/d/.ardia-download-1"]);
  const [left, done] = data.downloads;
  assert.equal(left.staging, "/d/.ardia-download-1");
  assert.equal(left.id, "saved-0");
  assert.ok(!("staging" in done));
  stagingRemovals.ok = true;
});

test("a restored record keeps its staging folder, so the next launch tries again", () => {
  removedStagings.length = 0;
  stagingRemovals.ok = false;
  const data = load([{ ...paused, id: "saved-0" }]);
  assert.deepEqual(removedStagings, ["/d/.ardia-download-1"]);
  assert.equal(data.downloads[0].staging, "/d/.ardia-download-1");
  stagingRemovals.ok = true;
});

test("a version 1 or 2 document drops the staging id and destination it kept beside the staging path", () => {
  for (const version of [1, 2]) {
    removedStagings.length = 0;
    stagingRemovals.ok = false;
    const old = { ...paused, id: "saved-0", stagingId: "1", destination: "/d/x" };
    const data = load([old, { ...finished, destination: "/d/y" }], version);
    assert.deepEqual(removedStagings, ["/d/.ardia-download-1"]);
    const [left, done] = data.downloads;
    assert.equal(left.staging, "/d/.ardia-download-1");
    assert.ok(!("stagingId" in left) && !("destination" in left) && !("destination" in done));
    stagingRemovals.ok = true;
  }
});

test("download progress leaves history unchanged while lifecycle changes and the final size survive a relaunch", () => {
  docs.clear();
  const stop = startPersistence();
  useBrowser.getState().createWindow({ url: "about:blank" });
  const update = (patch) => {
    useBrowser.getState().upsertDownload({ ...paused, state: "downloading", paused: false, ...patch });
    flushPersistence();
    return docs.get("downloads.json");
  };
  try {
    const initial = update({ received: 0, speed: 0 });
    for (const received of [10, 50, 100]) {
      assert.equal(update({ received, total: 200, speed: received * 2 }), initial, "progress alone must not rewrite history");
    }
    for (const patch of [{ paused: true }, { dangerous: true }, { path: "/d/renamed", filename: "renamed" }]) {
      const saved = JSON.parse(update(patch)).downloads[0];
      for (const [key, value] of Object.entries(patch)) assert.equal(saved[key], value);
    }
    update({ state: "finished", path: "/d/done", staging: null, total: 0, received: 12345, speed: 0 });
    const restored = loadSession().downloads[0];
    assert.equal(restored.state, "finished");
    assert.equal(restored.path, "/d/done");
    assert.equal(restored.received, 12345);
    assert.equal(restored.total, 0);
  } finally {
    stop();
  }
});
