import assert from "node:assert/strict";
import test from "node:test";
import { createHostDialogs } from "./hostDialogs.ts";

const { shellNativeModules } = await import("../../browser/src/test-native/shell.ts");
let current;
globalThis.acTestNativeModules = {
  ArdiaDialogs: {
    ...shellNativeModules.ArdiaDialogs,
    confirm: (options) => current.confirm(options),
    prompt: (options) => current.prompt(options),
  },
};
const { useBrowser } = await import("../../browser/src/state/browser/store.ts");
const { startRename, bookmarkTabs } = await import("../../browser/src/state/sidebar/actions.ts");
const { renameFolder } = await import("../../browser/src/state/sidebar/tileFolderUi.ts");
const { newTileFolder, folderIn } = await import("../../browser/src/state/pins/tileFolders.ts");
const { sidebarUi } = await import("../../browser/src/state/sidebar/sidebarUi.ts");
const { deleteProfile } = await import("../../browser/src/state/browser/actions.ts");
const { startWindowCloseGuard } = await import("../../browser/src/state/windows/windowClose.ts");
const { windows } = await import("../../browser/src/test-native/shell.ts");
const state = () => useBrowser.getState();
const turn = () => new Promise(setImmediate);

function fixture() {
  state().hydrate({});
  const windowId = state().createWindow({ url: "https://one.test" });
  const tab = state().windows[windowId].tabIds[0];
  const listeners = new Set(), requests = [];
  const host = {
    bootstrap: { windowId, profileId: "default" },
    onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async invoke(method, payload) {
      requests.push({ method, ...payload });
      return method.endsWith("windowIdentity") ? { windowId, rendererGeneration: "1" } : { accepted: true };
    },
  };
  current = createHostDialogs(host);
  const respond = (result) => {
    const { dialogId } = requests.findLast((r) => r.method.endsWith("beginDialog")).args[0];
    for (const listener of listeners) listener("ArdiaShell", "shell", { name: "shell.dialogResolved", data: { dialogId, windowId, rendererGeneration: "1", result } });
  };
  return { windowId, tab, requests, respond, adapter: current, host };
}

test("real essential rename awaits trimmed prompt; ordinary row stays inline", async () => {
  const f = fixture();
  state().pinTabs([f.tab], true);
  const work = startRename(f.windowId, { kind: "tab", id: f.tab });
  await turn();
  assert.equal(f.requests[1].args[0].options.confirmTitle, "Update");
  assert.equal(state().tabs[f.tab].customTitle, null);
  f.respond("  Essential  "); await work;
  assert.equal(state().tabs[f.tab].customTitle, "Essential");
  state().pinTabs([f.tab], true, true);
  await startRename(f.windowId, { kind: "tab", id: f.tab });
  assert.equal(f.requests.length, 2);
  assert.equal(sidebarUi().renaming.id, f.tab);
  f.adapter.retire();
});

test("real tile folder rename and bookmark folder creation use shell prompt", async () => {
  const f = fixture();
  state().pinTabs([f.tab], true);
  const folder = newTileFolder(state(), [f.tab], "Old folder");
  useBrowser.setState(folder.state);
  const rename = renameFolder(f.windowId, folder.folderId);
  await turn();
  assert.equal(f.requests.at(-1).args[0].options.value, "Old folder");
  f.respond(" New folder "); await rename;
  assert.equal(folderIn(state(), f.windowId, folder.folderId).name, "New folder");
  const before = Object.keys(state().bookmarks).length;
  const bookmark = bookmarkTabs(f.windowId, [f.tab], { kind: "newFolder" });
  await turn();
  assert.equal(f.requests.at(-1).args[0].options.confirmTitle, "Create");
  f.respond(null); await bookmark;
  assert.equal(Object.keys(state().bookmarks).length, before);
  f.adapter.retire();
});

test("real profile delete preserves destructive label and honors Cancel then Confirm", async () => {
  const f = fixture();
  const profile = state().createProfile({ name: "Disposable" });
  const canceled = deleteProfile(profile, f.windowId);
  await turn();
  const options = f.requests.at(-1).args[0].options;
  assert.equal(options.destructive, true);
  assert.equal(options.confirmTitle, "Delete Profile");
  assert.equal(options.windowId, f.windowId);
  assert.ok(state().profiles[profile]);
  f.respond({ confirmed: false, suppressed: false }); await canceled;
  assert.ok(state().profiles[profile]);
  const confirmed = deleteProfile(profile, f.windowId);
  await turn(); f.respond({ confirmed: true, suppressed: false }); await confirmed;
  assert.equal(state().profiles[profile], undefined);
  f.adapter.retire();
});

test("real window warning deduplicates and persists checkbox on Cancel without removing tabs", async () => {
  const f = fixture();
  state().newTab(f.windowId, { url: "https://two.test" });
  state().updateSettings({ warnBeforeClosingWindow: true });
  const before = [...state().windows[f.windowId].tabIds];
  startWindowCloseGuard();
  windows.emit({ type: "closeRequest", id: f.windowId });
  windows.emit({ type: "closeRequest", id: f.windowId });
  await turn();
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1].args[0].options.confirmTitle, "Close All Tabs");
  f.respond({ confirmed: false, suppressed: true });
  await turn();
  assert.equal(state().settings.warnBeforeClosingWindow, false);
  assert.deepEqual(state().windows[f.windowId].tabIds, before);
  f.adapter.retire();
});

test("real profile delete rejects an unavailable identity backend without deleting data", async () => {
  const f = fixture();
  const profile = state().createProfile({ name: "Keep" });
  f.host.invoke = async (method, payload) => {
    f.requests.push({ method, ...payload });
    throw Object.assign(new Error("Unsupported ArdiaShell.windowIdentity"), { code: "ERR_UNAVAILABLE" });
  };
  await assert.rejects(deleteProfile(profile, f.windowId), { code: "ERR_UNAVAILABLE" });
  assert.ok(state().profiles[profile]);
  assert.deepEqual(f.requests.map((request) => request.method), ["ArdiaShell.windowIdentity"]);
  f.adapter.retire();
});
