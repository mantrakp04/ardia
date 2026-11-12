import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const model = await import("../browser/model.ts");
const { downloadVisibleIn, downloadsIn } = await import("../downloads/downloadsSlice.ts");
const { lastActiveProfile, privateWindowProfile } = await import("./small.ts");
const { flushPersistence, startPersistence } = await import("../session/persist.ts");
const { startFavicons } = await import("../favicons/favicons.ts");
const { startHistory } = await import("../history/engineSync.ts");
const { startBookmarks } = await import("../bookmarks/engineSync.ts");
const { startProfileDataCleanup } = await import("../profiles/profileData.ts");
const { startPrivateSessions } = await import("../windows/privateSessions.ts");
const startApp = () => {
  const stops = [startPersistence(), startFavicons(), startHistory(), startBookmarks(), startProfileDataCleanup(), startPrivateSessions()];
  return () => stops.forEach((stop) => stop());
};
const { extensionProfile } = await import("../extensions/store.ts");
const stub = await import("../../test-native/index.ts");

const S = () => useBrowser.getState();
const PERSONAL = { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 };

function twoProfiles() {
  S().hydrate({ profiles: { default: PERSONAL }, profileOrder: ["default"] });
  const work = S().createProfile({ name: "Work" });
  const a = S().createWindow({ url: "https://a.example/" });
  const b = S().createWindow({ profileId: work, url: "https://b.example/" });
  S().setFocusedWindow(b);
  return { work, a, b };
}
const engine = (w) => model.engineProfile(S(), S().windows[w].profileId);
const session = (w) => model.privateSession(S(), S().windows[w].profileId);
const download = (id, profile, offTheRecord) => ({
  id, url: `https://dl.example/${id}`, filename: id, path: `/tmp/${id}`, state: "downloading", paused: false, received: 0, total: 1,
  speed: 0, mimeType: "", profile, offTheRecord,
});

test("⇧⌘N from a profile-2 window opens profile 2's private session; Personal's is another", () => {
  const { work, a, b } = twoProfiles();
  const p2 = S().createWindow({ kind: "private" });
  assert.equal(model.incognitoOriginal(S().windows[p2].profileId), work);
  assert.equal(S().tabs[S().windows[p2].tabIds[0]].profileId, S().windows[p2].profileId, "its tabs are its private profile's");
  assert.equal(engine(p2), `incognito:${p2}@${work}`, "the engine makes it from Work's off-the-record profile");
  assert.equal(session(p2), work);

  S().setFocusedWindow(p2);
  const p2b = S().createWindow({ kind: "private" });
  assert.equal(session(p2b), work);
  assert.notEqual(engine(p2b), engine(p2), "each window has its own name; the engine shares the profile");

  const p1 = S().createWindow({ kind: "private", profileId: "default" });
  assert.equal(engine(p1), `incognito:${p1}@`);
  assert.equal(session(p1), "");
  assert.notEqual(session(p1), session(p2));
  assert.equal(session(a), null);
  assert.equal(session(b), null);
});

test("a profile sharing another's data is in that profile's private session", () => {
  const { work } = twoProfiles();
  useBrowser.setState((s) => ({ profiles: { ...s.profiles, [work]: { ...s.profiles[work], dataId: "default" } } }));
  const p = S().createWindow({ kind: "private", profileId: work });
  assert.equal(session(p), "");
  assert.equal(engine(p), `incognito:${p}@`);
});

test("private windows don't page to another profile", () => {
  const { work } = twoProfiles();
  const p = S().createWindow({ kind: "private" });
  const before = S().windows[p].profileId;
  S().switchProfile(p, "default");
  assert.equal(S().windows[p].profileId, before);
  assert.equal(session(p), work);
});

test("Little Ardia from a profile-2 private window opens in profile 2, never privately (d9a8899e)", () => {
  const { work } = twoProfiles();
  const p = S().createWindow({ kind: "private" });
  S().setFocusedWindow(p);
  assert.equal(lastActiveProfile(S()), work);
  const small = S().createWindow({ kind: "small", url: "https://link.example/" });
  assert.equal(S().windows[small].profileId, work);
  assert.equal(S().windows[small].kind, "small");
});

test("a private session's downloads show in its windows only, never on disk, and go with its last window", async () => {
  stub.docs.clear();
  stub.cancelledDownloads.length = 0;
  const stop = startApp();
  const { work, a, b } = twoProfiles();
  const p2 = S().createWindow({ kind: "private" });
  const p2b = S().createWindow({ kind: "private", profileId: work });
  const p1 = S().createWindow({ kind: "private", profileId: "default" });
  S().upsertDownload(download("private2", work, true));
  S().upsertDownload(download("private1", "", true));
  S().upsertDownload(download("regular2", work, false));
  const ids = (w) => downloadsIn(S(), w).map((d) => d.id).sort();
  assert.deepEqual(ids(p2), ["private2"]);
  assert.deepEqual(ids(p2b), ["private2"], "a second window of the session lists it too");
  assert.deepEqual(ids(p1), ["private1"]);
  assert.deepEqual(ids(a), [], "Personal's window lists none of Work's downloads");
  assert.deepEqual(ids(b), ["regular2"]);
  S().upsertDownload(download("old", undefined, undefined));
  assert.deepEqual(ids(a), ["old"]);
  S().switchProfile(a, work);
  assert.deepEqual(ids(a), ["regular2"]);
  flushPersistence();
  const saved = stub.docs.get("downloads.json") ?? "";
  assert.ok(saved.includes("regular2"));
  assert.ok(!saved.includes("private"), "no private download reaches disk");

  S().closeWindow(p2);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(ids(p2b), ["private2"]);
  assert.deepEqual(stub.cancelledDownloads, []);
  S().closeWindow(p2b);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(stub.cancelledDownloads, ["private2"]);
  assert.ok(!S().downloads.some((d) => d.id === "private2"));
  assert.deepEqual(ids(p1), ["private1"]);
  S().upsertDownload({ ...download("private2", work, true), state: "cancelled" });
  S().upsertDownload(download("unseen", work, true));
  const next = S().createWindow({ kind: "private", profileId: work });
  S().upsertDownload({ ...download("private2", work, true), state: "cancelled" });
  S().upsertDownload(download("unseen", work, true));
  assert.deepEqual(ids(next), []);
  assert.ok(!downloadVisibleIn(S(), download("x", work, true), S().windows[a]));
  stop();
});

test("a private window lists its own profile's extensions (incognito-allowed ones), off the record", () => {
  const { work } = twoProfiles();
  const p2 = S().createWindow({ kind: "private" });
  const p1 = S().createWindow({ kind: "private", profileId: "default" });
  assert.equal(extensionProfile(S(), p2), work);
  assert.equal(extensionProfile(S(), p1), "");
});

test("a private window's bookmarks are its profile's", () => {
  const { work } = twoProfiles();
  const p2 = S().createWindow({ kind: "private" });
  assert.equal(model.bookmarkProfileId(S(), S().windows[p2]), work);
});

test("Open Link in Incognito Window: the private window is the tab's profile's, whichever window hears it", () => {
  const { work, a, b } = twoProfiles();
  assert.equal(privateWindowProfile(S(), S().windows[a], work), work);
  assert.equal(privateWindowProfile(S(), S().windows[b], ""), "default");
  assert.equal(privateWindowProfile(S(), S().windows[b]), work);
  const p = S().createWindow({ kind: "private", profileId: privateWindowProfile(S(), S().windows[b]) });
  assert.equal(privateWindowProfile(S(), S().windows[p]), work);
  assert.equal(model.incognitoOriginal(S().windows[p].profileId), work);
});

test("deleting a profile closes its private windows, not another profile's", () => {
  const { work } = twoProfiles();
  const p2 = S().createWindow({ kind: "private" });
  const p1 = S().createWindow({ kind: "private", profileId: "default" });
  S().deleteProfile(work);
  assert.ok(!S().windows[p2]);
  assert.ok(S().windows[p1]);
});

test("relaunch: no private window, tab or id is saved", () => {
  stub.docs.clear();
  const stop = startApp();
  const { work } = twoProfiles();
  S().createWindow({ kind: "private", url: "https://secret.example/" });
  S().createWindow({ kind: "private", profileId: "default", url: "https://secret.example/" });
  flushPersistence();
  const saved = stub.docs.get("session.json") ?? "";
  assert.ok(saved.includes(work));
  assert.ok(!saved.includes("incognito:") && !saved.includes('"incognito":true') && !saved.includes("secret.example"));
  stop();
});
