import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { lastActiveProfile, mainWindowFor } = await import("./small.ts");
const { flushPersistence, loadSession, startPersistence } = await import("../session/persist.ts");
const stub = await import("../../test-native/index.ts");

const S = () => useBrowser.getState();
const PERSONAL = { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 };

function twoProfilesTwoWindows() {
  S().hydrate({ profiles: { default: PERSONAL }, profileOrder: ["default"] });
  const work = S().createProfile({ name: "Work" });
  const a = S().createWindow({ url: "https://a.example/" });
  const b = S().createWindow({ url: "https://b.example/" });
  S().setFocusedWindow(a);
  S().switchProfile(a, work);
  return { work, a, b };
}

const openExternalUrls = ([url]) => S().createWindow({ small: true, url });
const openInMainWindow = (id) => {
  const tab = S().windows[id].tabIds[0];
  S().moveTabsToWindow([tab], mainWindowFor(S(), S().tabs[tab].profileId) ?? null);
};

const smallWindows = () => Object.values(S().windows).filter((w) => w.kind === "small");
const lastSmall = () => smallWindows().at(-1);

test("a link from another app opens Little Ardia in the profile of the last active window, not the default one", () => {
  const { work, a } = twoProfilesTwoWindows();
  assert.equal(S().settings.defaultProfileId, "default");
  assert.equal(lastActiveProfile(S()), work);
  openExternalUrls(["https://link.example/"]);
  const small = lastSmall();
  assert.equal(small.profileId, work);
  assert.equal(S().tabs[small.tabIds[0]].profileId, work);
  assert.equal(S().tabs[small.tabIds[0]].url, "https://link.example/");
  assert.equal(mainWindowFor(S(), work), a);
  openInMainWindow(small.id);
  assert.equal(smallWindows().length, 0);
  assert.ok(S().windows[a].tabIds.some((t) => S().tabs[t].url === "https://link.example/" && S().tabs[t].profileId === work));
});

test("with several windows, the one used last wins, even after another app took focus", () => {
  const { work, a, b } = twoProfilesTwoWindows();
  S().setFocusedWindow(b);
  openExternalUrls(["https://one.example/"]);
  assert.equal(lastSmall().profileId, "default");
  S().setFocusedWindow(a);
  openExternalUrls(["https://two.example/"]);
  assert.equal(lastSmall().profileId, work);
});

test("paging the focused window to another profile makes that profile the last active one", () => {
  const { work, a } = twoProfilesTwoWindows();
  S().switchProfile(a, "default");
  assert.equal(lastActiveProfile(S()), "default");
  S().switchProfile(a, work);
  assert.equal(lastActiveProfile(S()), work);
});

test("several links, or the setting off, go to the last active window and its profile", () => {
  const { work, a, b } = twoProfilesTwoWindows();
  S().setFocusedWindow(b);
  S().switchProfile(b, work);
  S().setFocusedWindow(a);
  assert.equal(lastActiveProfile(S()), work);
  assert.equal(mainWindowFor(S(), lastActiveProfile(S())), a);
});

test("a private window counts as the regular profile it was opened from; Little Ardia is never private", () => {
  const { work, a, b } = twoProfilesTwoWindows();
  const priv = S().createWindow({ incognito: true });
  assert.equal(S().windows[priv].originalProfileId, work);
  S().setFocusedWindow(b);
  S().setFocusedWindow(priv);
  assert.equal(lastActiveProfile(S()), work);
  openExternalUrls(["https://p.example/"]);
  const small = lastSmall();
  assert.equal(small.incognito, false);
  assert.equal(small.profileId, work);
  assert.equal(mainWindowFor(S(), work), a);
  S().closeWindow(small.id);
  S().closeWindow(priv);
  assert.equal(lastActiveProfile(S()), work);
  openExternalUrls(["https://q.example/"]);
  assert.equal(lastSmall().profileId, work);
});

test("a private window opened from Personal counts as Personal", () => {
  const { b } = twoProfilesTwoWindows();
  S().setFocusedWindow(b);
  const priv = S().createWindow({ incognito: true });
  assert.equal(S().windows[priv].originalProfileId, "default");
  assert.equal(lastActiveProfile(S()), "default");
});

test("the window in front closing hands over to the next most recent window's profile", () => {
  const { work, a, b } = twoProfilesTwoWindows();
  const c = S().createWindow({ url: "https://c.example/" });
  S().setFocusedWindow(b);
  S().setFocusedWindow(a);
  assert.equal(lastActiveProfile(S()), work);
  S().closeWindow(a);
  assert.equal(lastActiveProfile(S()), "default");
  assert.equal(S().ui.focusedWindowId, b);
  openExternalUrls(["https://after-close.example/"]);
  assert.equal(lastSmall().profileId, "default");
  S().closeWindow(lastSmall().id);
  S().setFocusedWindow(b);
  S().switchProfile(b, work);
  S().closeWindow(c);
  assert.equal(lastActiveProfile(S()), work);
  S().closeWindow(b);
  assert.equal(Object.keys(S().windows).length, 0);
  assert.equal(lastActiveProfile(S()), work);
});

test("a deleted profile falls back to the window used before, then the default profile", () => {
  const { work, b } = twoProfilesTwoWindows();
  S().deleteProfile(work);
  assert.equal(S().profiles[work], undefined);
  assert.equal(lastActiveProfile(S()), S().windows[b].profileId);
  openExternalUrls(["https://after-delete.example/"]);
  assert.equal(lastSmall().profileId, "default");
});

test("the last active profile survives a quit and relaunch", () => {
  stub.docs.clear();
  const stop = startPersistence();
  const { work, b } = twoProfilesTwoWindows();
  const priv = S().createWindow({ incognito: true });
  S().setFocusedWindow(b);
  S().setFocusedWindow(priv);
  flushPersistence();
  stop();
  const saved = loadSession();
  assert.equal(saved.lastProfileId, work);
  S().hydrate(saved);
  assert.equal(S().ui.lastProfileId, work);
  assert.equal(S().ui.focusedWindowId, b);
  openExternalUrls(["https://after-relaunch.example/"]);
  assert.equal(lastSmall().profileId, work);
  S().hydrate({ ...saved, lastProfileId: "gone" });
  assert.equal(S().ui.lastProfileId, null);
  assert.equal(lastActiveProfile(S()), "default");
  stub.docs.clear();
});
