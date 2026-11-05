import assert from "node:assert/strict";
import { test } from "node:test";
await import("../../test-native/index.ts");
const { useBrowser } = await import("../browser/store.ts");
const { openFromPage, cascadedFrame } = await import("./openFromPage.ts");

const S = () => useBrowser.getState();
const PERSONAL = { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 };
const WORK = { id: "work", name: "Work", color: "blue", icon: null, createdAt: 0 };

function littleArdiaBesideMainWindow() {
  S().hydrate({ profiles: { default: PERSONAL, work: WORK }, profileOrder: ["default", "work"], windows: {}, tabs: {} });
  const main = S().createWindow({ url: "https://main.example/" });
  const small = S().createWindow({ kind: "small", url: "https://little.example/", profileId: "work", frame: [400, 500, 900, 640] });
  const tabId = S().windows[small].tabIds[0];
  return { main, small, tabId, page: { windowId: small, profileId: "work", tabId } };
}

const smallWindows = () => Object.values(S().windows).filter((w) => w.kind === "small");
const urlsOf = (windowId) => S().windows[windowId].tabIds.map((id) => S().tabs[id].url);
const pageOf = (windowId) => S().tabs[S().windows[windowId].tabIds[0]].page;

test("a new-tab link in Little Ardia opens a new Little Ardia in its profile, cascaded from it, adopting Chrome's tab", () => {
  const { main, small, page } = littleArdiaBesideMainWindow();
  openFromPage({ url: "https://github.com/", disposition: "foreground", adoptId: "tab:42" }, page);
  const opened = smallWindows().filter((w) => w.id !== small);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].profileId, "work");
  assert.deepEqual(opened[0].frame, [422, 478, 900, 640]);
  assert.equal(pageOf(opened[0].id).adopt, "tab:42");
  assert.deepEqual(urlsOf(small), ["https://little.example/"]);
  assert.deepEqual(urlsOf(main), ["https://main.example/"]);
});

test("a ⌘-click in Little Ardia still opens behind, as a tab of the main window", () => {
  const { main, small, page } = littleArdiaBesideMainWindow();
  openFromPage({ url: "https://github.com/", disposition: "background" }, page);
  assert.deepEqual(smallWindows().map((w) => w.id), [small]);
  assert.equal(S().windows[main].tabIds.length, 2);
});

test("a new-tab link in a main window still opens a tab there", () => {
  const { main } = littleArdiaBesideMainWindow();
  const tabId = S().windows[main].tabIds[0];
  openFromPage({ url: "https://github.com/", disposition: "foreground" }, { windowId: main, profileId: "default", tabId });
  assert.equal(smallWindows().length, 1);
  assert.equal(S().windows[main].tabIds.length, 2);
});

test("a new-tab link from a Little Ardia without a known frame opens one with no frame, so it takes the default placement", () => {
  S().hydrate({ profiles: { default: PERSONAL }, profileOrder: ["default"], windows: {}, tabs: {} });
  const small = S().createWindow({ kind: "small", url: "https://little.example/" });
  const tabId = S().windows[small].tabIds[0];
  assert.equal(S().windows[small].frame, null);
  openFromPage({ url: "https://github.com/", disposition: "foreground", adoptId: "tab:7" }, { windowId: small, profileId: "default", tabId });
  const opened = smallWindows().filter((w) => w.id !== small);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].frame, null);
  assert.equal(pageOf(opened[0].id).adopt, "tab:7");
  assert.equal(cascadedFrame(null), undefined);
});
