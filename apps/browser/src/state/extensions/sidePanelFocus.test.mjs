import assert from "node:assert/strict";
import { test } from "node:test";
const native = await import("../../test-native/index.ts");
const { useBrowser } = await import("../browser/store.ts");
const { usePages } = await import("../tabs/pageState.ts");
const { useExtensions } = await import("./store.ts");
const panels = await import("./sidePanels.ts");

const S = () => useBrowser.getState();
const E = () => useExtensions.getState();
const base = { enabled: true, pinned: true, hasAction: true, incognito: false };
const ONE = { ...base, id: "one", name: "One", sidePanel: "panel.html" };
const TWO = { ...base, id: "two", name: "Two", sidePanel: "panel.html" };

function setup() {
  S().hydrate({});
  const w = S().createWindow({ url: "a.com" });
  const a = S().windows[w].tabIds[0];
  const b = S().newTab(w, { url: "b.com", background: true });
  usePages.setState({ ready: { [a]: 1, [b]: 2 } });
  useExtensions.setState({ lists: { "": [ONE, TWO] }, actions: {}, popup: null, sidePanels: {}, sidePanelLookups: {} });
  const paths = { [a]: "a.html", [b]: "b.html" };
  native.extensionAnswers.sidePanelUrl = async (tabId, extensionId) => `chrome-extension://${extensionId}/${paths[tabId]}`;
  return { w, a, b };
}

const open = async (w, extensionId = "one") => {
  await panels.openSidePanel(w, extensionId);
  return E().sidePanels[w];
};

const take = (w, panel) => panels.takeSidePanelFocus(w, panel);

function holdLookups() {
  const answer = native.extensionAnswers.sidePanelUrl;
  const held = [];
  native.extensionAnswers.sidePanelUrl = (tabId, extensionId) => new Promise((resolve) => held.push(() => resolve(answer(tabId, extensionId))));
  return held;
}

test("a panel the user opens takes keyboard focus once", async () => {
  const { w } = setup();
  const panel = await open(w);
  assert.equal(take(w, panel), true);
  assert.equal(take(w, panel), false);
  panels.closeSidePanel(w);
});

test("a tab switch that swaps the panel's page after it took focus leaves focus with the page", async () => {
  const { w, b } = setup();
  const first = await open(w);
  assert.equal(take(w, first), true);
  S().activate(b);
  await panels.syncSidePanel(w);
  const second = E().sidePanels[w];
  assert.equal(second.url, "chrome-extension://one/b.html");
  assert.equal(second.opened, first.opened);
  assert.equal(take(w, second), false);
  panels.closeSidePanel(w);
});

test("a tab switch before the panel loaded leaves focus with the page the user switched to", async () => {
  const { w, b } = setup();
  const first = await open(w);
  S().activate(b);
  await panels.syncSidePanel(w);
  const second = E().sidePanels[w];
  assert.notEqual(second, first);
  assert.equal(take(w, second), false);
  assert.equal(take(w, first), false);
  panels.closeSidePanel(w);
});

test("a card that loads while the tab switch's page lookup is in flight leaves focus with the page", async () => {
  const { w, b } = setup();
  const first = await open(w);
  const held = holdLookups();
  S().activate(b);
  const sync = panels.syncSidePanel(w);
  assert.equal(take(w, first), false);
  held[0]();
  await sync;
  const second = E().sidePanels[w];
  assert.equal(second.url, "chrome-extension://one/b.html");
  assert.equal(take(w, second), false);
  panels.closeSidePanel(w);
});

test("switching away and back before the panel loaded still leaves focus with the page", async () => {
  const { w, a, b } = setup();
  await open(w);
  S().activate(b);
  await panels.syncSidePanel(w);
  S().activate(a);
  await panels.syncSidePanel(w);
  const back = E().sidePanels[w];
  assert.equal(back.url, "chrome-extension://one/a.html");
  assert.equal(take(w, back), false);
  panels.closeSidePanel(w);
});

test("a card that loads while a same-tab page lookup is in flight leaves focus for the page that replaces it", async () => {
  const { w, a } = setup();
  const first = await open(w);
  native.extensionAnswers.sidePanelUrl = async (tabId, extensionId) => `chrome-extension://${extensionId}/${tabId === a ? "a2" : "b"}.html`;
  const held = holdLookups();
  const sync = panels.syncSidePanel(w);
  assert.equal(take(w, first), false);
  held[0]();
  await sync;
  const second = E().sidePanels[w];
  assert.equal(second.url, "chrome-extension://one/a2.html");
  assert.equal(take(w, first), false, "the replaced card, still on screen until the next render, retries and is refused");
  assert.equal(take(w, second), true);
  panels.closeSidePanel(w);
});

test("a card that loads while a lookup is in flight takes focus once the lookup leaves its page in place", async () => {
  const { w } = setup();
  const panel = await open(w);
  const held = holdLookups();
  const sync = panels.syncSidePanel(w);
  assert.equal(take(w, panel), false);
  held[0]();
  await sync;
  assert.equal(E().sidePanels[w], panel);
  assert.equal(take(w, panel), true);
  panels.closeSidePanel(w);
});

test("a page swap on the same tab before the panel loaded passes focus to the replacing page", async () => {
  const { w, a } = setup();
  const first = await open(w);
  native.extensionAnswers.sidePanelUrl = async (tabId, extensionId) => `chrome-extension://${extensionId}/${tabId === a ? "a2" : "b"}.html`;
  await panels.syncSidePanel(w);
  const second = E().sidePanels[w];
  assert.equal(second.url, "chrome-extension://one/a2.html");
  assert.equal(take(w, second), true);
  panels.closeSidePanel(w);
});

test("a sync that changes nothing keeps the panel and its focus", async () => {
  const { w } = setup();
  const panel = await open(w);
  await panels.syncSidePanel(w);
  assert.equal(E().sidePanels[w], panel);
  assert.equal(take(w, panel), true);
  panels.closeSidePanel(w);
});

test("closing and reopening the panel takes keyboard focus again each time", async () => {
  const { w } = setup();
  for (let round = 0; round < 3; round++) {
    const panel = await open(w);
    assert.equal(take(w, panel), true, `open ${round}`);
    panels.closeSidePanel(w);
  }
});

test("reopening while the closing card is still on screen gives that card a new opening to take focus with", async () => {
  const { w } = setup();
  const first = await open(w);
  assert.equal(take(w, first), true);
  panels.closeSidePanel(w);
  const second = await open(w);
  assert.equal(second.url, first.url);
  assert.notEqual(second.opened, first.opened);
  assert.equal(take(w, first), false);
  assert.equal(take(w, second), true);
  panels.closeSidePanel(w);
});

test("switching to another extension's panel takes focus on its page", async () => {
  const { w } = setup();
  const first = await open(w, "one");
  assert.equal(take(w, first), true);
  const second = await open(w, "two");
  assert.equal(second.extensionId, "two");
  assert.equal(take(w, second), true);
  panels.closeSidePanel(w);
});

test("reopening a panel before another panel's page lookup finishes gives the shown card a new opening", async () => {
  const { w } = setup();
  const first = await open(w, "one");
  assert.equal(take(w, first), true);
  const away = panels.openSidePanel(w, "two");
  const back = panels.openSidePanel(w, "one");
  await Promise.all([away, back]);
  const second = E().sidePanels[w];
  assert.equal(second.extensionId, "one");
  assert.notEqual(second.opened, first.opened);
  assert.equal(take(w, second), true);
  panels.closeSidePanel(w);
});

test("opening the panel that is already open is not a new opening", async () => {
  const { w } = setup();
  const panel = await open(w);
  await panels.openSidePanel(w, "one");
  assert.equal(E().sidePanels[w], panel);
  assert.equal(take(w, panel), true);
  await panels.openSidePanel(w, "one");
  assert.equal(E().sidePanels[w], panel);
  assert.equal(take(w, panel), false);
  panels.closeSidePanel(w);
});

test("closing the panel before its card loads drops its focus", async () => {
  const { w } = setup();
  const panel = await open(w);
  panels.closeSidePanel(w);
  assert.equal(take(w, panel), false);
});

test("a panel of another window never takes focus", async () => {
  const { w } = setup();
  const panel = await open(w);
  assert.equal(take("other", panel), false);
  assert.equal(take(w, panel), true);
  panels.closeSidePanel(w);
});
