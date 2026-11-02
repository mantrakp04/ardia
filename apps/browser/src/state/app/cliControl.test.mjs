import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

globalThis.__DEV__ = false;
registerHooks({
  resolve(specifier, context, next) {
    if (!context.parentURL?.endsWith("/state/app/cliControl.ts") || specifier !== "../pages/urls") return next(specifier, context);
    const stub = "export const isInternalTab = (t) => /^ardia:\\/\\//i.test(t.page.nav?.url ?? t.url ?? '');";
    return { url: `data:text/javascript,${encodeURIComponent(stub)}`, shortCircuit: true };
  },
});
const calls = [];
const replies = [];
globalThis.acTestCliControl = (on) => {
  calls.push(on);
  return new Promise((resolve) => replies.push(resolve));
};
const { useBrowser } = await import("../browser/store.ts");
const cli = await import("./cliControl.ts");
const settle = () => new Promise((r) => setImmediate(r));
const setOn = (on) => useBrowser.getState().updateSettings({ cliControl: on });
const { emitEvent } = await import("../../test-native/index.ts");
const emit = (status) => emitEvent("engine.cliControl", status);
const { markTabReady } = await import("../tabs/pageState.ts");
const ready = (tabId) => (markTabReady(tabId), cli.noteTabReady(tabId));

cli.startCliControl();
await settle();
replies.shift()({ state: "off", generation: 0 });
await settle();

test("a failure from a superseded enable doesn't turn off a newer retry", async () => {
  calls.length = 0;
  setOn(true);
  const first = replies.shift();
  setOn(false);
  replies.shift()({ state: "off", generation: 1 });
  setOn(true);
  replies.shift()({ state: "starting", generation: 2 });
  await settle();
  first({ state: "off", generation: 1, reason: "Couldn't listen on 127.0.0.1." });
  emit({ state: "off", generation: 1, reason: "Couldn't listen on 127.0.0.1." });
  await settle();
  assert.deepEqual(calls, [true, false, true]);
  assert.equal(useBrowser.getState().settings.cliControl, true);
  assert.equal(cli.useCli.getState().server?.generation, 2);
});

test("a failure of the current start still turns the setting off and keeps the reason", async () => {
  emit({ state: "off", generation: 2, reason: "Couldn't write ArdiaControl.json: is a directory" });
  await settle();
  assert.equal(useBrowser.getState().settings.cliControl, false);
  assert.match(cli.useCli.getState().server?.reason ?? "", /is a directory/);
  assert.deepEqual(calls, [true, false, true, false]);
});

test("the engine hears which page the user is looking at while control is on", async () => {
  const active = [];
  globalThis.acTestCliActive = (id) => (active.push(id), Promise.resolve({}));
  const S = useBrowser.getState;
  S().hydrate({});
  const w = S().createWindow({ url: "https://a.com" });
  S().setFocusedWindow(w);
  const a = S().windows[w].tabIds[0];
  const b = S().newTab(w, { url: "https://b.com", background: true });
  ready(a);
  ready(b);
  emit({ state: "on", generation: 3, connections: 0 });
  await settle();
  assert.deepEqual(active, [a]);
  S().activate(b);
  await settle();
  assert.deepEqual(active, [a, b]);
  S().newTab(w, {});
  await settle();
  assert.deepEqual(active, [a, b, null], "New Tab has no page");
  emit({ state: "off", generation: 3 });
  S().activate(a);
  await settle();
  assert.deepEqual(active, [a, b, null], "nothing is sent while control is off");
});

test("a page parked behind New Tab or an Ardia page is not what the user is looking at", async () => {
  const active = [];
  globalThis.acTestCliActive = (id) => (active.push(id), Promise.resolve({}));
  const { patchPage } = await import("../tabs/pageState.ts");
  const S = useBrowser.getState;
  S().hydrate({});
  const w = S().createWindow({ url: "https://a.com" });
  S().setFocusedWindow(w);
  const a = S().windows[w].tabIds[0];
  ready(a);
  emit({ state: "on", generation: 4, connections: 0 });
  await settle();
  assert.deepEqual(active, [a]);
  const tab = S().tabs[a];
  patchPage(a, { newTabShown: { url: tab.url, title: tab.title, favicon: null } });
  S().updateTab(a, { url: "", title: "", favicon: null });
  await settle();
  assert.deepEqual(active, [a, null], "Back to New Tab keeps the WebContents for Forward, but shows New Tab");
  patchPage(a, { newTabShown: null });
  S().updateTab(a, { url: tab.url, title: tab.title });
  await settle();
  assert.deepEqual(active, [a, null, a], "Forward shows the page again");
  S().updateTab(a, { url: "ardia://settings", page: { kind: "loaded", nav: { ...S().tabs[a].page.nav, url: "ardia://settings" } } });
  await settle();
  assert.deepEqual(active, [a, null, a, null], "an Ardia page over a parked WebContents");
  emit({ state: "off", generation: 4 });
  await settle();
});
