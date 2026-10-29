import assert from "node:assert/strict";
import test from "node:test";
import { useBrowser } from "../../browser/src/state/browser/store.ts";
import { initialHostSession, startHostPersistence } from "./hostSession.ts";
import { adoptUnclaimedTab, unclaimedAdoptId, watchUnclaimedTabs } from "./unclaimedTabs.ts";

const S = () => useBrowser.getState();
const tick = () => new Promise(setImmediate);
const URL_A = "chrome-extension://fixture/opened.html#clicked";

function nativeHost({ bootstrap = { windowId: "main", profileId: "default", startup: false }, parked = [] } = {}) {
  const calls = [];
  const listeners = new Set();
  return {
    calls,
    bootstrap,
    invoke(method, args) {
      calls.push([method, structuredClone(args)]);
      if (method === "ArdiaTabs.unclaimedTabs") return Promise.resolve(parked);
      return Promise.resolve(null);
    },
    call: async () => "null",
    onEvent: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    emit: (module, event, payload) => { for (const listener of [...listeners]) listener(module, event, payload); },
  };
}

function freshWindow() {
  S().hydrate(initialHostSession({ bootstrap: { windowId: "main", profileId: "default", startup: false } }, null));
  const w = S().windows.main;
  return { first: w.activeTabIds[w.profileId] };
}

const active = () => S().windows.main.activeTabIds[S().windows.main.profileId];
const tabsAt = (url) => Object.values(S().tabs).filter((t) => t.windowId === "main" && t.url === url);

test("only well-formed native tab offers become adoption ids", () => {
  assert.equal(unclaimedAdoptId({ adoptId: "tab:12", url: URL_A, active: true }), "tab:12");
  assert.equal(unclaimedAdoptId({ adoptId: "tab:12", url: "", active: true }), "tab:12");
  for (const offer of [null, "tab:12", { adoptId: "link:3", url: URL_A }, { adoptId: "tab:", url: URL_A }, { adoptId: "tab:1x", url: URL_A }, { adoptId: 12, url: URL_A }, { adoptId: "tab:12" }]) {
    assert.equal(unclaimedAdoptId(offer), undefined, JSON.stringify(offer));
  }
});

test("an active unclaimed tab opens selected in its window and an inactive one keeps the selection", () => {
  const { first } = freshWindow();
  const opened = adoptUnclaimedTab(useBrowser, "main", { adoptId: "tab:21", url: URL_A, active: true });
  assert.equal(active(), opened);
  assert.deepEqual(S().tabs[opened].page, { kind: "adopted", adopt: "tab:21", nav: null });
  assert.equal(S().tabs[opened].profileId, "default");
  const behind = adoptUnclaimedTab(useBrowser, "main", { adoptId: "tab:22", url: "https://background.example/", active: false });
  assert.equal(active(), opened);
  assert.ok(S().windows.main.tabIds.includes(behind));
  assert.notEqual(opened, first);
  assert.equal(adoptUnclaimedTab(useBrowser, "elsewhere", { adoptId: "tab:23", url: URL_A, active: true }), undefined);
  assert.equal(adoptUnclaimedTab(useBrowser, "main", { adoptId: "link:24", url: URL_A, active: true }), undefined);
});

test("the shell pulls tabs parked before it listened and adopts later ones from events, in its own window only", async () => {
  freshWindow();
  const host = nativeHost({ parked: [{ adoptId: "tab:31", url: URL_A, active: true }, { adoptId: "bogus", url: "https://x.example/", active: true }] });
  const stop = watchUnclaimedTabs(host, useBrowser);
  assert.deepEqual(host.calls, [["ArdiaTabs.unclaimedTabs", { args: [] }]]);
  await tick();
  assert.equal(tabsAt(URL_A).length, 1);
  assert.equal(active(), tabsAt(URL_A)[0].id);
  host.emit("ArdiaTabs", "unclaimed", { adoptId: "tab:32", url: "https://later.example/", active: false });
  host.emit("ArdiaTabs", "tabs", { adoptId: "tab:33", url: "https://wrong-event.example/", active: true });
  host.emit("ArdiaExtensions", "unclaimed", { adoptId: "tab:34", url: "https://wrong-module.example/", active: true });
  assert.equal(tabsAt("https://later.example/").length, 1);
  assert.equal(tabsAt("https://wrong-event.example/").length, 0);
  assert.equal(tabsAt("https://wrong-module.example/").length, 0);
  assert.equal(active(), tabsAt(URL_A)[0].id);
  stop();
  host.emit("ArdiaTabs", "unclaimed", { adoptId: "tab:35", url: "https://stopped.example/", active: true });
  assert.equal(tabsAt("https://stopped.example/").length, 0);
});

test("a window Chrome made is saved with its adopted tabs instead of waiting for an opener", async (t) => {
  const previous = { window: globalThis.window, document: globalThis.document };
  globalThis.window = new EventTarget();
  globalThis.document = Object.assign(new EventTarget(), { hidden: false });
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  });
  const saved = initialHostSession({ bootstrap: { windowId: "main", profileId: "default", startup: false } }, null, 50);
  const save = async (bootstrap) => {
    const host = nativeHost({ bootstrap });
    S().hydrate(initialHostSession(host, saved, 100));
    const persistence = startHostPersistence(host, useBrowser, saved);
    await persistence.flush();
    await tick();
    const writes = host.calls.filter(([method]) => method === "session.write").map(([, args]) => args.session);
    return writes.at(-1)?.windows?.["window-9"];
  };
  const adoptTabs = [{ adoptId: "tab:41", url: URL_A, active: true }];
  const kept = await save({ windowId: "window-9", profileId: "default", startup: false, chromeMade: true, adoptTabs });
  assert.ok(kept, "the Chrome-made window reaches the saved session");
  assert.equal(kept.tabIds.length, 1);
  assert.equal(await save({ windowId: "window-9", profileId: "default", startup: false, adoptTabs }), undefined);
});
