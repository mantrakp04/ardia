import assert from "node:assert/strict";
import test from "node:test";
import { create } from "zustand";
import { followInstallRequest, leftoverInstallRequest, ownsInstallRequest } from "./installRequestSheet.ts";

const request = (windowId, name = "Fixture") => ({ windowId, profile: "", source: "unpacked", status: "ready", pkg: { name, path: `/tmp/${name}` } });

function sheet(windowId = "settings", install = null, leftover = null) {
  const store = create(() => ({ install }));
  const closed = [];
  const stop = followInstallRequest(store, windowId, () => closed.push(store.getState().install), leftover);
  return { store, closed, stop };
}

test("a sheet opened before the chosen folder is read stays open until the request arrives and is answered", () => {
  const f = sheet();
  assert.deepEqual(f.closed, []);
  f.store.setState({ install: request("settings") });
  assert.deepEqual(f.closed, []);
  f.store.setState({ install: { ...request("settings"), status: "installing" } });
  assert.deepEqual(f.closed, []);
  f.store.setState({ install: null });
  assert.deepEqual(f.closed, [null]);
  f.stop();
});

test("every Choose Folder… in a row gets its own dialog, and each answer closes the sheet once", () => {
  for (const name of ["first", "second", "third"]) {
    const f = sheet();
    assert.deepEqual(f.closed, [], `${name}: closed before the folder came back`);
    f.store.setState({ install: request("settings", name) });
    f.store.setState({ install: null });
    f.store.setState({ install: null });
    assert.equal(f.closed.length, 1, name);
    f.stop();
  }
});

test("a request that arrived between the press and the sheet subscribing is followed and closes the sheet when answered", () => {
  const f = sheet("settings", request("settings"));
  f.store.setState({ install: null });
  assert.deepEqual(f.closed, [null]);
  f.stop();
});

test("a request for another window neither opens nor closes the Settings sheet", () => {
  const f = sheet();
  f.store.setState({ install: request("main") });
  f.store.setState({ install: null });
  assert.deepEqual(f.closed, []);
  f.store.setState({ install: request("settings") });
  f.store.setState({ install: request("main") });
  assert.equal(f.closed.length, 1);
  f.stop();
});

test("an unmounted sheet stops following", () => {
  const f = sheet();
  f.store.setState({ install: request("settings") });
  f.stop();
  f.store.setState({ install: null });
  assert.deepEqual(f.closed, []);
});

test("a request left behind by a replaced sheet is never shown by the next Choose Folder…, and the new folder's request is", () => {
  const old = request("settings", "previous");
  const f = sheet("settings", old, old);
  assert.equal(ownsInstallRequest(f.store.getState().install, "settings", old), false, "the previous folder's dialog shows before the new chooser returns");
  f.store.setState({ install: old });
  assert.deepEqual(f.closed, []);
  const fresh = request("settings", "chosen");
  f.store.setState({ install: fresh });
  assert.equal(ownsInstallRequest(f.store.getState().install, "settings", old), true);
  assert.deepEqual(f.closed, []);
  f.store.setState({ install: null });
  assert.deepEqual(f.closed, [null]);
  f.stop();
});

test("a left-over request isn't cancelled or answered by the sheet that ignores it", () => {
  const old = { ...request("settings", "previous"), source: "webStore", prompt: { requestId: "install4" } };
  const f = sheet("settings", old, old);
  f.store.setState({ install: null });
  assert.deepEqual(f.closed, [], "the left-over request going away closes a sheet that never showed it");
  f.store.setState({ install: old });
  assert.equal(f.store.getState().install, old);
  f.stop();
});

test("a request is shown only by its own window's sheet", () => {
  const live = request("settings");
  assert.equal(ownsInstallRequest(live, "settings", null), true);
  assert.equal(ownsInstallRequest(live, "main", null), false);
  assert.equal(ownsInstallRequest(null, "settings", null), false);
  assert.equal(ownsInstallRequest({ ...live }, "settings", live), true, "an updated copy of a request is a new request");
});

test("a mistyped Web Store link's own error, set before the sheet mounts, is shown and closes the sheet when dismissed", () => {
  const error = { windowId: "settings", profile: "", source: "webStore", status: "error", error: "That isn't a link to an extension in the Chrome Web Store." };
  const leftover = leftoverInstallRequest(error);
  assert.equal(leftover, null);
  assert.equal(ownsInstallRequest(error, "settings", leftover), true);
  const f = sheet("settings", error, leftover);
  f.store.setState({ install: null });
  assert.deepEqual(f.closed, [null]);
  f.stop();
});

test("only a Load Unpacked request waiting when the sheet mounts counts as left behind", () => {
  const stale = request("settings", "previous");
  assert.equal(leftoverInstallRequest(stale), stale);
  assert.equal(leftoverInstallRequest({ ...stale, status: "error", error: "bad manifest" }).source, "unpacked");
  assert.equal(leftoverInstallRequest(null), null);
});
