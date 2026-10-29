import assert from "node:assert/strict";
import { test } from "node:test";
const model = await import("../browser/model.ts");
const { useBrowser } = await import("../browser/store.ts");
const { lastActiveSpace, mainWindowFor } = await import("./small.ts");
const { flushPersistence, loadSession, startPersistence } = await import("../session/persist.ts");
const stub = await import("../../test-native/index.ts");

const S = () => useBrowser.getState();
const PERSONAL = { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 };

function twoSpacesTwoWindows() {
  S().hydrate({ spaces: { default: PERSONAL }, spaceOrder: ["default"] });
  const work = S().createSpace({ name: "Work", profileId: S().createProfile({ name: "Work" }) });
  const a = S().createWindow({ url: "https://a.example/" });
  const b = S().createWindow({ url: "https://b.example/" });
  S().setFocusedWindow(a);
  S().switchSpace(a, work);
  return { work, a, b };
}

const openExternalUrls = ([url]) => S().createWindow({ kind: "small", url });
const openInMainWindow = (id) => {
  const tab = S().windows[id].tabIds[0];
  S().moveTabsToWindow([tab], mainWindowFor(S(), S().tabs[tab].spaceId) ?? null);
};

const smallWindows = () => Object.values(S().windows).filter((w) => w.kind === "small");
const lastSmall = () => smallWindows().at(-1);

test("a link from another app opens Little Ardia in the space of the last active window, not the default one", () => {
  const { work, a } = twoSpacesTwoWindows();
  assert.equal(S().settings.defaultSpaceId, "default");
  assert.equal(lastActiveSpace(S()), work);
  openExternalUrls(["https://link.example/"]);
  const small = lastSmall();
  assert.equal(small.spaceId, work);
  assert.equal(S().tabs[small.tabIds[0]].spaceId, work);
  assert.equal(S().tabs[small.tabIds[0]].url, "https://link.example/");
  assert.equal(mainWindowFor(S(), work), a);
  openInMainWindow(small.id);
  assert.equal(smallWindows().length, 0);
  assert.ok(S().windows[a].tabIds.some((t) => S().tabs[t].url === "https://link.example/" && S().tabs[t].spaceId === work));
});

test("with several windows, the one used last wins, even after another app took focus", () => {
  const { work, a, b } = twoSpacesTwoWindows();
  S().setFocusedWindow(b);
  openExternalUrls(["https://one.example/"]);
  assert.equal(lastSmall().spaceId, "default");
  S().setFocusedWindow(a);
  openExternalUrls(["https://two.example/"]);
  assert.equal(lastSmall().spaceId, work);
});

test("paging the focused window to another space makes that space the last active one", () => {
  const { work, a } = twoSpacesTwoWindows();
  S().switchSpace(a, "default");
  assert.equal(lastActiveSpace(S()), "default");
  S().switchSpace(a, work);
  assert.equal(lastActiveSpace(S()), work);
});

test("several links, or the setting off, go to the last active window and its space", () => {
  const { work, a, b } = twoSpacesTwoWindows();
  S().setFocusedWindow(b);
  S().switchSpace(b, work);
  S().setFocusedWindow(a);
  assert.equal(lastActiveSpace(S()), work);
  assert.equal(mainWindowFor(S(), lastActiveSpace(S())), a);
});

test("a private window counts as the regular profile it was opened from; Little Ardia is never private", () => {
  const { work, a, b } = twoSpacesTwoWindows();
  const priv = S().createWindow({ kind: "private" });
  assert.equal(model.incognitoOriginal(S().windows[priv].spaceId), work);
  S().setFocusedWindow(b);
  S().setFocusedWindow(priv);
  assert.equal(lastActiveSpace(S()), work);
  openExternalUrls(["https://p.example/"]);
  const small = lastSmall();
  assert.equal(small.kind, "small");
  assert.equal(small.spaceId, work);
  assert.equal(mainWindowFor(S(), work), a);
  S().closeWindow(small.id);
  S().closeWindow(priv);
  assert.equal(lastActiveSpace(S()), work);
  openExternalUrls(["https://q.example/"]);
  assert.equal(lastSmall().spaceId, work);
});

test("a private window opened from Personal counts as Personal", () => {
  const { b } = twoSpacesTwoWindows();
  S().setFocusedWindow(b);
  const priv = S().createWindow({ kind: "private" });
  assert.equal(model.incognitoOriginal(S().windows[priv].spaceId), "default");
  assert.equal(lastActiveSpace(S()), "default");
});

test("the window in front closing hands over to the next most recent window's space", () => {
  const { work, a, b } = twoSpacesTwoWindows();
  const c = S().createWindow({ url: "https://c.example/" });
  S().setFocusedWindow(b);
  S().setFocusedWindow(a);
  assert.equal(lastActiveSpace(S()), work);
  S().closeWindow(a);
  assert.equal(lastActiveSpace(S()), "default");
  assert.equal((S().ui.focusOrder[0] ?? null), b);
  openExternalUrls(["https://after-close.example/"]);
  assert.equal(lastSmall().spaceId, "default");
  S().closeWindow(lastSmall().id);
  S().setFocusedWindow(b);
  S().switchSpace(b, work);
  S().closeWindow(c);
  assert.equal(lastActiveSpace(S()), work);
  S().closeWindow(b);
  assert.equal(Object.keys(S().windows).length, 0);
  assert.equal(lastActiveSpace(S()), work);
});

test("a deleted space falls back to the window used before, then the default space", () => {
  const { work, b } = twoSpacesTwoWindows();
  S().deleteSpace(work);
  assert.equal(S().spaces[work], undefined);
  assert.equal(lastActiveSpace(S()), S().windows[b].spaceId);
  openExternalUrls(["https://after-delete.example/"]);
  assert.equal(lastSmall().spaceId, "default");
});

test("the last active space survives a quit and relaunch", () => {
  stub.docs.clear();
  const stop = startPersistence();
  const { work, b } = twoSpacesTwoWindows();
  const priv = S().createWindow({ kind: "private" });
  S().setFocusedWindow(b);
  S().setFocusedWindow(priv);
  flushPersistence();
  stop();
  const saved = loadSession();
  assert.equal(saved.lastSpaceId, work);
  S().hydrate(saved);
  assert.equal(S().ui.lastSpaceId, work);
  assert.equal((S().ui.focusOrder[0] ?? null), b);
  openExternalUrls(["https://after-relaunch.example/"]);
  assert.equal(lastSmall().spaceId, work);
  S().hydrate({ ...saved, lastSpaceId: "gone" });
  assert.equal(S().ui.lastSpaceId, null);
  assert.equal(lastActiveSpace(S()), "default");
  stub.docs.clear();
});

for (const source of ["main", "private", "none"]) test(`New Window uses the configured default Space from ${source}`, async () => {
  const { work, a } = twoSpacesTwoWindows();
  const { runCommand } = await import("../commands/commands.ts");
  const windowId = source === "private" ? S().createWindow({ kind: "private", spaceId: work }) : source === "main" ? a : undefined;
  const before = new Set(S().windowOrder);
  runCommand({ command: "newWindow", windowId });
  const created = S().windowOrder.find((id) => !before.has(id));
  assert.ok(created);
  assert.equal(S().windows[created].kind, "main");
  assert.equal(S().windows[created].spaceId, S().settings.defaultSpaceId);
});
