import assert from "node:assert/strict";
import { test } from "node:test";
await import("../../test-native/index.ts");
const { useBrowser } = await import("../browser/store.ts");
const { openExternalUrls } = await import("./actions.ts");

const S = () => useBrowser.getState();
const PERSONAL = { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 };

function mainWindow(settings) {
  S().hydrate({ profiles: { default: PERSONAL }, profileOrder: ["default"], windows: {}, tabs: {} });
  const main = S().createWindow({ url: "https://pinned.example/" });
  S().togglePin(S().windows[main].tabIds[0]);
  const b = S().newTab(main, { url: "https://b.example/", background: true });
  S().newTab(main, { url: "https://c.example/", background: true });
  S().activate(b);
  S().setFocusedWindow(main);
  S().updateSettings({ openLinksInLittleArdia: false, ...settings });
  return main;
}

const urlsOf = (windowId) => S().windows[windowId].tabIds.map((id) => S().tabs[id].url);
const opened = async (urls) => {
  openExternalUrls(urls);
  await new Promise((resolve) => setImmediate(resolve));
};

test("with Put links from other apps first, app links go just below the pinned tabs, in order, whatever Add new tabs says", async () => {
  const main = mainWindow({ newTabPosition: "nextToCurrent", appLinksFirst: true });
  await opened(["https://one.example/", "https://two.example/"]);
  assert.deepEqual(urlsOf(main), ["https://pinned.example/", "https://one.example/", "https://two.example/", "https://b.example/", "https://c.example/"]);
});

for (const [start, setUp] of [
  ["no window", () => {}],
  ["a window with only a blank tab", () => S().createWindow({})],
]) {
  test(`with it on and ${start}, several app links keep their order`, async () => {
    S().hydrate({ profiles: { default: PERSONAL }, profileOrder: ["default"], windows: {}, tabs: {} });
    S().updateSettings({ openLinksInLittleArdia: false, appLinksFirst: true });
    setUp();
    await opened(["https://one.example/", "https://two.example/", "https://three.example/"]);
    const [main] = Object.keys(S().windows);
    assert.deepEqual(urlsOf(main), ["https://one.example/", "https://two.example/", "https://three.example/"]);
  });
}

test("with it off, app links follow Add new tabs as before", async () => {
  const main = mainWindow({ newTabPosition: "nextToCurrent", appLinksFirst: false });
  await opened(["https://one.example/"]);
  assert.deepEqual(urlsOf(main), ["https://pinned.example/", "https://b.example/", "https://c.example/", "https://one.example/"]);
});
