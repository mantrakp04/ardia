import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

registerHooks({
  resolve(specifier, context, next) {
    if (!context.parentURL?.endsWith("/browser/actions.ts") || specifier !== "../windows/profilePager") return next(specifier, context);
    return { url: `data:text/javascript,${encodeURIComponent("export const pageToProfile = () => {};")}`, shortCircuit: true };
  },
});

const { useBrowser } = await import("../browser/store.ts");
const { decideLastTabClose, decideWindowClose } = await import("./windowClose.ts");
const { closeTab } = await import("../browser/actions.ts");
const { closeWindowAnimated, isWindowClosing } = await import("./closeAnimated.ts");
const { managesWindowClose, setManagedWindowClose } = await import("../../platform/windowClose.ts");
const stub = await import("../../test-native/index.ts");

const S = () => useBrowser.getState();
const PERSONAL = { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 };
let nativeAsks = 0;
stub.shellNativeModules.ArdiaDialogs.confirm = () => { ++nativeAsks; return Promise.resolve({ confirmed: true, suppressed: false }); };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function windowWith(urls) {
  S().hydrate({ profiles: { default: PERSONAL }, profileOrder: ["default"] });
  S().updateSettings({ warnBeforeClosingWindow: true, warnBeforeClosingLastTab: true });
  const id = S().createWindow({ url: urls[0] });
  for (const url of urls.slice(1)) S().newTab(id, { url });
  nativeAsks = 0;
  return id;
}

const shape = () => JSON.stringify({ windows: S().windows, tabs: S().tabs, order: S().windowOrder, settings: S().settings, closed: S().closedWindows });

test("decideWindowClose returns the decision and checkbox without touching windows, tabs or settings", async () => {
  const id = windowWith(["https://a.example/", "https://b.example/"]);
  const before = shape();
  const asked = [];
  const ask = async (options) => { asked.push(options); return { confirmed: false, suppressed: true }; };
  assert.deepEqual(await decideWindowClose(id, ask), { decision: "cancel", suppressWarning: true });
  assert.equal(asked.length, 1);
  assert.equal(asked[0].title, "Close 2 tabs?");
  assert.equal(asked[0].suppression, "Don’t ask me again");
  assert.equal(asked[0].windowId, id);
  assert.deepEqual(await decideWindowClose(id, async () => ({ confirmed: true, suppressed: false })), { decision: "allow", suppressWarning: false });
  assert.equal(shape(), before);
  assert.equal(isWindowClosing(id), false);
  assert.equal(nativeAsks, 0);
});

test("decideWindowClose allows small and unwarned windows without asking", async () => {
  const one = windowWith(["https://a.example/"]);
  const never = async () => assert.fail("no warning expected");
  assert.deepEqual(await decideWindowClose(one, never), { decision: "allow", suppressWarning: false });
  const many = windowWith(["https://a.example/", "https://b.example/"]);
  S().updateSettings({ warnBeforeClosingWindow: false });
  assert.deepEqual(await decideWindowClose(many, never), { decision: "allow", suppressWarning: false });
  S().updateSettings({ warnBeforeClosingWindow: true });
  const before = shape();
  assert.deepEqual(await decideWindowClose(many), { decision: "allow", suppressWarning: false });
  assert.equal(nativeAsks, 1);
  assert.equal(shape(), before);
});

test("decideLastTabClose follows warnBeforeClosingLastTab, skips private windows and never mutates", async () => {
  const id = windowWith(["https://a.example/"]);
  const before = shape();
  S().updateSettings({ warnBeforeClosingWindow: false });
  const ask = async () => ({ confirmed: false, suppressed: true });
  assert.deepEqual(await decideLastTabClose(id, ask), { decision: "cancel", suppressWarning: true });
  S().updateSettings({ warnBeforeClosingWindow: true });
  assert.equal(shape(), before);
  S().updateSettings({ warnBeforeClosingLastTab: false });
  assert.deepEqual(await decideLastTabClose(id, ask), { decision: "allow", suppressWarning: false });
  const incognito = S().createWindow({ kind: "private", url: "https://private.example/" });
  S().updateSettings({ warnBeforeClosingLastTab: true });
  assert.deepEqual(await decideLastTabClose(incognito, ask), { decision: "allow", suppressWarning: false });
});

test("the managed close seam defaults to today's behaviour and, once registered, receives last-tab and animated closes before any mutation", async () => {
  assert.equal(managesWindowClose("any", "window"), false);
  const id = windowWith(["https://a.example/"]);
  const tab = S().windows[id].tabIds[0];
  const routed = [];
  setManagedWindowClose((windowId, reason) => { routed.push([windowId, reason]); return windowId === id; });
  try {
    const before = shape();
    await closeTab(tab);
    closeWindowAnimated(id);
    await settle();
    assert.deepEqual(routed, [[id, "lastTab"], [id, "window"]]);
    assert.equal(nativeAsks, 0);
    assert.equal(isWindowClosing(id), false);
    assert.equal(shape(), before);
    const other = S().createWindow({ url: "https://b.example/" });
    await closeTab(S().windows[other].tabIds[0]);
    await settle();
    assert.deepEqual(routed.slice(2), [[other, "lastTab"], [other, "window"]]);
    assert.equal(nativeAsks, 1);
    assert.equal(S().windows[other], undefined);
    const small = S().createWindow({ kind: "small", url: "https://link.example/" });
    routed.length = 0;
    closeWindowAnimated(small, id, () => {});
    await settle();
    assert.deepEqual(routed, []);
    assert.equal(S().windows[small], undefined);
  } finally {
    setManagedWindowClose(() => false);
  }
  await closeTab(tab);
  await settle();
  assert.equal(nativeAsks, 2);
  assert.equal(S().windows[id], undefined);
});
