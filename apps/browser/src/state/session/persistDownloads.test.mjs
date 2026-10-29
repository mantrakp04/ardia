import assert from "node:assert/strict";
import { test } from "node:test";
import { docs, removedStagings, stagingRemovals } from "../../test-native/index.ts";
import { loadSession } from "./persist.ts";

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
