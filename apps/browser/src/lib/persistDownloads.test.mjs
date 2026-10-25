import assert from "node:assert/strict";
import { test } from "node:test";
import { docs, removedStagings, stagingRemovals } from "@ardia/shell";
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
  destination: "/d/x",
};
const finished = { ...paused, id: "wk-download-2", path: "/d/y", state: "finished", paused: false, staging: null, destination: "/d/y" };

function load() {
  docs.set("session.json", JSON.stringify({ version: 2, windows: [], tabs: [] }));
  docs.set("downloads.json", JSON.stringify({ version: 1, downloads: [paused, finished] }));
  return loadSession();
}

test("a download left paused at quit asks for its staging folder to go, and keeps it named until it has", () => {
  removedStagings.length = 0;
  stagingRemovals.ok = false;
  const data = load();
  assert.deepEqual(removedStagings, ["/d/.ardia-download-1"]);
  const [left, done] = data.downloads;
  assert.equal(left.staging, "/d/.ardia-download-1");
  assert.equal(left.stagingId, "1");
  assert.equal(left.destination, "/d/x");
  assert.equal(left.id, "saved-0");
  assert.ok(!("staging" in done) && !("destination" in done));
  stagingRemovals.ok = true;
});

test("a restored record keeps its staging folder's id, so the next launch tries again", () => {
  removedStagings.length = 0;
  stagingRemovals.ok = false;
  docs.set("session.json", JSON.stringify({ version: 2, windows: [], tabs: [] }));
  docs.set("downloads.json", JSON.stringify({ version: 1, downloads: [{ ...paused, id: "saved-0", stagingId: "1" }] }));
  const data = loadSession();
  assert.deepEqual(removedStagings, ["/d/.ardia-download-1"]);
  assert.equal(data.downloads[0].stagingId, "1");
  stagingRemovals.ok = true;
});
