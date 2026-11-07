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
  useExtensions.setState({ lists: { "": [ONE, TWO] }, actions: {}, popup: null, sidePanels: {} });
  const paths = { [a]: "a.html", [b]: "b.html" };
  native.extensionAnswers.sidePanelUrl = async (tabId, extensionId) => `chrome-extension://${extensionId}/${paths[tabId]}`;
  return { w, a, b };
}

const open = async (w, extensionId = "one") => {
  await panels.openSidePanel(w, extensionId);
  return E().sidePanels[w];
};

test("a panel the user opens takes keyboard focus on its first finished load, once", async () => {
  const { w } = setup();
  const panel = await open(w);
  assert.equal(panels.takeSidePanelFocus(w, panel), true);
  assert.equal(panels.takeSidePanelFocus(w, panel), false);
  panels.closeSidePanel(w);
});

test("a tab switch that swaps the panel's page after it opened leaves keyboard focus where it is", async () => {
  const { w, b } = setup();
  const first = await open(w);
  assert.equal(panels.takeSidePanelFocus(w, first), true);
  S().activate(b);
  await panels.syncSidePanel(w);
  const second = E().sidePanels[w];
  assert.equal(second.url, "chrome-extension://one/b.html");
  assert.equal(panels.takeSidePanelFocus(w, second), false);
  panels.closeSidePanel(w);
});

test("a swap of the panel's page before it finished loading passes the focus request to the page that replaced it, once", async () => {
  const { w, b } = setup();
  const first = await open(w);
  S().activate(b);
  await panels.syncSidePanel(w);
  const second = E().sidePanels[w];
  assert.notEqual(second, first);
  assert.equal(second.opened, first.opened);
  assert.equal(panels.takeSidePanelFocus(w, second), true);
  assert.equal(panels.takeSidePanelFocus(w, second), false);
  panels.closeSidePanel(w);
});

test("a sync that changes nothing keeps the opened panel's focus request", async () => {
  const { w } = setup();
  const panel = await open(w);
  await panels.syncSidePanel(w);
  assert.equal(E().sidePanels[w], panel);
  assert.equal(panels.takeSidePanelFocus(w, panel), true);
  panels.closeSidePanel(w);
});

test("closing and reopening the panel takes keyboard focus again each time", async () => {
  const { w } = setup();
  for (let round = 0; round < 3; round++) {
    const panel = await open(w);
    assert.equal(panels.takeSidePanelFocus(w, panel), true, `open ${round}`);
    panels.closeSidePanel(w);
  }
});

test("reopening while the closing card is still on screen makes a new card that asks for focus", async () => {
  const { w } = setup();
  const first = await open(w);
  assert.equal(panels.takeSidePanelFocus(w, first), true);
  panels.closeSidePanel(w);
  const second = await open(w);
  assert.equal(second.url, first.url);
  assert.notEqual(panels.sidePanelKey(second), panels.sidePanelKey(first));
  assert.equal(panels.takeSidePanelFocus(w, first), false);
  assert.equal(panels.takeSidePanelFocus(w, second), true);
  panels.closeSidePanel(w);
});

test("switching to another extension's panel asks for focus on its page", async () => {
  const { w } = setup();
  const first = await open(w, "one");
  assert.equal(panels.takeSidePanelFocus(w, first), true);
  const second = await open(w, "two");
  assert.equal(second.extensionId, "two");
  assert.equal(panels.takeSidePanelFocus(w, second), true);
  panels.closeSidePanel(w);
});

test("opening the panel that is already open keeps a pending request and never makes a new one", async () => {
  const { w } = setup();
  const panel = await open(w);
  await panels.openSidePanel(w, "one");
  assert.equal(E().sidePanels[w], panel);
  assert.equal(panels.takeSidePanelFocus(w, panel), true);
  await panels.openSidePanel(w, "one");
  assert.equal(E().sidePanels[w], panel);
  assert.equal(panels.takeSidePanelFocus(w, panel), false);
  panels.closeSidePanel(w);
});

test("a panel opened while no card is mounted still takes focus when its card loads later", async () => {
  const { w } = setup();
  const panel = await open(w);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(panels.takeSidePanelFocus(w, panel), true);
  panels.closeSidePanel(w);
});

test("closing the panel before its card loads drops the focus request", async () => {
  const { w } = setup();
  const panel = await open(w);
  panels.closeSidePanel(w);
  assert.equal(panels.takeSidePanelFocus(w, panel), false);
});

test("a panel of another window never takes the request", async () => {
  const { w } = setup();
  const panel = await open(w);
  assert.equal(panels.takeSidePanelFocus("other", panel), false);
  assert.equal(panels.takeSidePanelFocus(w, panel), true);
  panels.closeSidePanel(w);
});
