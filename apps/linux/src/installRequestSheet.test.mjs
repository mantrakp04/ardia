import assert from "node:assert/strict";
import test from "node:test";
import { create } from "zustand";
import { followInstallFailures, followInstallRequest, leftoverInstallRequest, ownsInstallRequest } from "./installRequestSheet.ts";

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
  assert.equal(ownsInstallRequest({ ...live, status: "installing" }, "settings", live), false, "an update of a left-behind request is still that request");
  assert.equal(ownsInstallRequest(request("settings", "other"), "settings", live), true, "another folder's request is a new request");
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

test("Choose Folder…'s own request, stored just before its sheet mounts, is shown and closes the sheet when answered", () => {
  const fresh = request("settings", "chosen");
  const leftover = leftoverInstallRequest(fresh);
  assert.equal(leftover, null);
  assert.equal(ownsInstallRequest(fresh, "settings", leftover), true);
  const f = sheet("settings", fresh, leftover);
  f.store.setState({ install: null });
  assert.deepEqual(f.closed, [null]);
  f.stop();
});

test("a Load Unpacked request a replaced sheet left unanswered is left behind for the next sheet, and a new folder's request is not", () => {
  const first = sheet();
  const abandoned = request("settings", "previous");
  first.store.setState({ install: abandoned });
  first.stop();
  assert.equal(leftoverInstallRequest(abandoned), abandoned);
  assert.equal(ownsInstallRequest(abandoned, "settings", leftoverInstallRequest(abandoned)), false);
  const fresh = request("settings", "chosen");
  assert.equal(leftoverInstallRequest(fresh), null);
  assert.equal(leftoverInstallRequest(null), null);
});

test("a sheet that closes after its request was answered, or with another window's or a Web Store request waiting, leaves nothing behind", () => {
  const answered = sheet();
  const done = request("settings", "done");
  answered.store.setState({ install: done });
  answered.store.setState({ install: null });
  answered.stop();
  assert.equal(leftoverInstallRequest(done), null);
  const other = sheet();
  const elsewhere = request("main", "elsewhere");
  other.store.setState({ install: elsewhere });
  other.stop();
  assert.equal(leftoverInstallRequest(elsewhere), null);
  const store = sheet();
  const prompt = { ...request("settings", "store"), source: "webStore", prompt: { requestId: "install5" } };
  store.store.setState({ install: prompt });
  store.stop();
  assert.equal(leftoverInstallRequest(prompt), null);
});

test("an unpacked install whose sheet was replaced while it installed stays left behind when it fails, for a sheet mounted during the install and one mounted after", () => {
  const replaced = sheet();
  const failures = followInstallFailures(replaced.store);
  const ready = request("settings", "pending");
  replaced.store.setState({ install: ready });
  const installing = { ...ready, status: "installing" };
  replaced.store.setState({ install: installing });
  replaced.stop();
  const during = leftoverInstallRequest(installing);
  assert.equal(during, installing);
  failures.failed(ready.pkg);
  replaced.store.setState({ lists: {} });
  const failed = { windowId: "settings", profile: "", source: "unpacked", status: "error", error: "The manifest is invalid." };
  replaced.store.setState({ install: failed });
  assert.equal(ownsInstallRequest(failed, "settings", during), false, "a sheet mounted while it installed doesn't show its failure");
  assert.equal(leftoverInstallRequest(failed), failed, "a sheet mounted after it failed doesn't show the failure as fresh");
  const fresh = { windowId: "settings", profile: "", source: "unpacked", status: "error", error: "Choose a folder with a manifest." };
  replaced.store.setState({ install: fresh });
  assert.equal(leftoverInstallRequest(fresh), null, "the next folder's own error is fresh");
  failures.stop();
});

test("a failed install whose sheet stayed open shows its error in that sheet", () => {
  const f = sheet();
  const failures = followInstallFailures(f.store);
  const ready = request("settings", "kept");
  f.store.setState({ install: ready });
  f.store.setState({ install: { ...ready, status: "installing" } });
  failures.failed(ready.pkg);
  const failed = { windowId: "settings", profile: "", source: "unpacked", status: "error", error: "The manifest is invalid." };
  f.store.setState({ install: failed });
  assert.equal(leftoverInstallRequest(failed), null);
  assert.equal(ownsInstallRequest(failed, "settings", null), true);
  assert.deepEqual(f.closed, []);
  f.stop();
  failures.stop();
});

test("the Linux install adapter ties a failed unpacked install's error back to the request it came from", async () => {
  const { installExtension } = await import("./extensionInstalls.ts");
  const { useExtensions } = await import("./extensionsStore.ts");
  const ready = { ...request("settings", "adapter"), pkg: { name: "adapter", path: "/tmp/adapter" } };
  useExtensions.setState({ install: ready });
  const stop = followInstallRequest(useExtensions, "settings", () => {});
  useExtensions.setState({ install: { ...ready, status: "installing" } });
  stop();
  await assert.rejects(installExtension(ready.pkg, ""));
  const failed = { windowId: "settings", profile: "", source: "unpacked", status: "error", error: "no extension engine in this test" };
  useExtensions.setState({ install: failed });
  assert.equal(leftoverInstallRequest(failed), failed);
  useExtensions.setState({ install: null });
});
