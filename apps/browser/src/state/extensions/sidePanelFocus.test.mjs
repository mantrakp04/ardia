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

const take = (w, panel) => {
  let taken = false;
  panels.requestSidePanelFocus(w, panel, () => {
    taken = true;
  });
  return taken;
};

test("a panel the user opens is granted one focus request, taken once", async () => {
  const { w } = setup();
  const panel = await open(w);
  assert.equal(take(w, panel), true);
  assert.equal(take(w, panel), false);
  panels.closeSidePanel(w);
});

test("a tab switch that swaps the panel's page after the request was taken makes no new request", async () => {
  const { w, b } = setup();
  const first = await open(w);
  assert.equal(take(w, first), true);
  S().activate(b);
  await panels.syncSidePanel(w);
  const second = E().sidePanels[w];
  assert.equal(second.url, "chrome-extension://one/b.html");
  assert.equal(take(w, second), false);
  panels.closeSidePanel(w);
});

test("a swap of the panel's page before the request was taken passes it to the replacing panel, once", async () => {
  const { w, b } = setup();
  const first = await open(w);
  S().activate(b);
  await panels.syncSidePanel(w);
  const second = E().sidePanels[w];
  assert.notEqual(second, first);
  assert.equal(second.opened, first.opened);
  assert.equal(take(w, second), true);
  assert.equal(take(w, second), false);
  panels.closeSidePanel(w);
});

test("a sync that changes nothing keeps the opened panel's focus request", async () => {
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

test("reopening while the closing card is still on screen makes a new card that asks for focus", async () => {
  const { w } = setup();
  const first = await open(w);
  assert.equal(take(w, first), true);
  panels.closeSidePanel(w);
  const second = await open(w);
  assert.equal(second.url, first.url);
  assert.notEqual(panels.sidePanelKey(second), panels.sidePanelKey(first));
  assert.equal(take(w, first), false);
  assert.equal(take(w, second), true);
  panels.closeSidePanel(w);
});

test("switching to another extension's panel asks for focus on its page", async () => {
  const { w } = setup();
  const first = await open(w, "one");
  assert.equal(take(w, first), true);
  const second = await open(w, "two");
  assert.equal(second.extensionId, "two");
  assert.equal(take(w, second), true);
  panels.closeSidePanel(w);
});

test("reopening a panel before another panel's page lookup finishes gives the shown card a new focus request", async () => {
  const { w } = setup();
  const first = await open(w, "one");
  assert.equal(take(w, first), true);
  const away = panels.openSidePanel(w, "two");
  const back = panels.openSidePanel(w, "one");
  await Promise.all([away, back]);
  const second = E().sidePanels[w];
  assert.equal(second.extensionId, "one");
  assert.notEqual(second.opened, first.opened);
  assert.notEqual(panels.sidePanelKey(second), panels.sidePanelKey(first));
  assert.equal(take(w, second), true);
  panels.closeSidePanel(w);
});

test("opening the panel that is already open keeps a pending request and never makes a new one", async () => {
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

test("a panel opened while no card is mounted still takes focus when its card loads later", async () => {
  const { w } = setup();
  const panel = await open(w);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(take(w, panel), true);
  panels.closeSidePanel(w);
});

test("closing the panel before its card loads drops the focus request", async () => {
  const { w } = setup();
  const panel = await open(w);
  panels.closeSidePanel(w);
  assert.equal(take(w, panel), false);
});

test("a panel of another window never takes the request", async () => {
  const { w } = setup();
  const panel = await open(w);
  assert.equal(take("other", panel), false);
  assert.equal(take(w, panel), true);
  panels.closeSidePanel(w);
});

function holdLookups() {
  const answer = native.extensionAnswers.sidePanelUrl;
  const held = [];
  native.extensionAnswers.sidePanelUrl = (tabId, extensionId) =>
    new Promise((resolve, reject) => held.push({ resolve: () => resolve(answer(tabId, extensionId)), reject }));
  return held;
}

const requestLater = (w, panel) => {
  const calls = [];
  panels.requestSidePanelFocus(w, panel, () => calls.push(panel.url));
  return calls;
};

test("a card that finishes loading while another page's lookup is in flight leaves the request for the page that replaces it", async () => {
  const { w, b } = setup();
  const first = await open(w);
  const held = holdLookups();
  S().activate(b);
  const sync = panels.syncSidePanel(w);
  const calls = requestLater(w, first);
  assert.deepEqual(calls, []);
  held[0].resolve();
  await sync;
  const second = E().sidePanels[w];
  assert.equal(second.url, "chrome-extension://one/b.html");
  assert.deepEqual(calls, []);
  assert.equal(take(w, second), true);
  assert.equal(take(w, second), false);
  panels.closeSidePanel(w);
});

test("a card that finishes loading while a lookup is in flight takes focus once the lookup leaves its page in place", async () => {
  const { w } = setup();
  const panel = await open(w);
  const held = holdLookups();
  const sync = panels.syncSidePanel(w);
  const calls = requestLater(w, panel);
  assert.deepEqual(calls, []);
  held[0].resolve();
  await sync;
  assert.equal(E().sidePanels[w], panel);
  assert.deepEqual(calls, [panel.url]);
  assert.equal(take(w, panel), false);
  panels.closeSidePanel(w);
});

test("a request waits for the newest of several lookups", async () => {
  const { w, a, b } = setup();
  const panel = await open(w);
  const held = holdLookups();
  S().activate(b);
  const toB = panels.syncSidePanel(w);
  S().activate(a);
  const toA = panels.syncSidePanel(w);
  const calls = requestLater(w, panel);
  held[0].resolve();
  await toB;
  assert.deepEqual(calls, []);
  held[1].resolve();
  await toA;
  assert.equal(E().sidePanels[w], panel);
  assert.deepEqual(calls, [panel.url]);
  panels.closeSidePanel(w);
});

test("a request waiting for a lookup is dropped when the lookup closes the panel", async () => {
  const { w } = setup();
  const panel = await open(w);
  native.extensionAnswers.sidePanelUrl = async () => null;
  const sync = panels.syncSidePanel(w);
  const calls = requestLater(w, panel);
  await sync;
  assert.equal(E().sidePanels[w], undefined);
  assert.deepEqual(calls, []);
});

test("a request waiting for a lookup that fails is granted to the panel still shown", async () => {
  const { w } = setup();
  const panel = await open(w);
  const held = holdLookups();
  const sync = panels.syncSidePanel(w);
  const calls = requestLater(w, panel);
  held[0].reject(new Error("lookup failed"));
  await assert.rejects(sync, /lookup failed/);
  assert.deepEqual(calls, [panel.url]);
  panels.closeSidePanel(w);
});

test("closing and reopening while a lookup is in flight does not hand the old request to the new opening", async () => {
  const { w } = setup();
  const first = await open(w);
  const held = holdLookups();
  const sync = panels.syncSidePanel(w);
  const calls = requestLater(w, first);
  panels.closeSidePanel(w);
  const reopened = panels.openSidePanel(w, "one");
  held[0].resolve();
  held[1].resolve();
  await Promise.all([sync, reopened]);
  const second = E().sidePanels[w];
  assert.notEqual(second.opened, first.opened);
  assert.deepEqual(calls, []);
  assert.equal(take(w, second), true);
  panels.closeSidePanel(w);
});

test("a card that unmounts while its request waits for a lookup leaves the request for the card that replaces it", async () => {
  const { w } = setup();
  const panel = await open(w);
  const held = holdLookups();
  const sync = panels.syncSidePanel(w);
  const calls = requestLater(w, panel);
  panels.withdrawSidePanelFocus(w, panel);
  held[0].resolve();
  await sync;
  assert.equal(E().sidePanels[w], panel);
  assert.deepEqual(calls, []);
  assert.equal(take(w, panel), true);
  assert.equal(take(w, panel), false);
  panels.closeSidePanel(w);
});

test("withdrawing the request of a card that is not the one waiting changes nothing", async () => {
  const { w, b } = setup();
  const first = await open(w);
  S().activate(b);
  await panels.syncSidePanel(w);
  const second = E().sidePanels[w];
  const held = holdLookups();
  S().activate(b);
  const sync = panels.syncSidePanel(w);
  const calls = requestLater(w, second);
  panels.withdrawSidePanelFocus(w, first);
  held[0].resolve();
  await sync;
  assert.equal(E().sidePanels[w], second);
  assert.deepEqual(calls, [second.url]);
  panels.closeSidePanel(w);
});
