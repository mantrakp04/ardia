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
const { startWindowCloseGuard } = await import("./windowClose.ts");
const { closeTab } = await import("../browser/actions.ts");
const { isWindowClosing } = await import("./closeAnimated.ts");
const stub = await import("../../test-native/index.ts");

const S = () => useBrowser.getState();
const PERSONAL = { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 };
const asks = [];
let answer = { confirmed: false, suppressed: false };
stub.shellNativeModules.ArdiaDialogs.confirm = (options) => {
  asks.push(options);
  return Promise.resolve(answer);
};
startWindowCloseGuard();
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function windowWith(urls, options = {}) {
  S().hydrate({ profiles: { default: PERSONAL }, profileOrder: ["default"] });
  S().updateSettings({ warnBeforeClosingWindow: true, warnBeforeClosingLastTab: true });
  const id = S().createWindow({ url: urls[0], ...options });
  for (const url of urls.slice(1)) S().newTab(id, { url });
  asks.length = 0;
  return id;
}

const dialog = (id, count) => ({
  title: count === 1 ? "Close 1 tab?" : `Close ${count} tabs?`,
  message: `This window has ${count} ${count === 1 ? "tab" : "tabs"} open in your Personal profile.`,
  confirmTitle: count === 1 ? "Close Tab" : "Close All Tabs",
  suppression: "Don’t ask me again",
  windowId: id,
});

test("closing a window with several tabs asks first; Cancel keeps it and the checkbox still turns the warning off", async () => {
  const id = windowWith(["https://a.example/", "https://b.example/"]);
  const tabs = [...S().windows[id].tabIds];
  answer = { confirmed: false, suppressed: true };
  stub.windows.emit({ type: "closeRequest", id });
  stub.windows.emit({ type: "closeRequest", id });
  await settle();
  assert.deepEqual(asks, [dialog(id, 2)]);
  assert.deepEqual(S().windows[id].tabIds, tabs);
  assert.equal(isWindowClosing(id), false);
  assert.equal(S().settings.warnBeforeClosingWindow, false);
  assert.equal(S().settings.warnBeforeClosingLastTab, true);
});

test("confirming the window warning animates the close and removes the window", async () => {
  const id = windowWith(["https://a.example/", "https://b.example/", "https://c.example/"]);
  answer = { confirmed: true, suppressed: false };
  stub.windows.emit({ type: "closeRequest", id });
  await settle();
  assert.deepEqual(asks, [dialog(id, 3)]);
  assert.equal(S().windows[id], undefined);
  assert.equal(S().settings.warnBeforeClosingWindow, true);
});

test("a single-tab window or a disabled warning closes without asking", async () => {
  const one = windowWith(["https://a.example/"]);
  stub.windows.emit({ type: "closeRequest", id: one });
  await settle();
  assert.equal(S().windows[one], undefined);
  const many = windowWith(["https://a.example/", "https://b.example/"]);
  S().updateSettings({ warnBeforeClosingWindow: false });
  stub.windows.emit({ type: "closeRequest", id: many });
  await settle();
  assert.equal(asks.length, 0);
  assert.equal(S().windows[many], undefined);
});

test("Little Ardia closes through its own path without the window warning", async () => {
  windowWith(["https://a.example/"]);
  const small = S().createWindow({ kind: "small", url: "https://link.example/" });
  stub.windows.emit({ type: "closeRequest", id: small });
  await settle();
  assert.equal(asks.length, 0);
  assert.equal(S().windows[small], undefined);
});

test("closing the last tab uses its own warning and setting, distinct from the window warning", async () => {
  const id = windowWith(["https://a.example/"]);
  const tab = S().windows[id].tabIds[0];
  answer = { confirmed: false, suppressed: true };
  await closeTab(tab);
  assert.deepEqual(asks, [dialog(id, 1)]);
  assert.ok(S().tabs[tab]);
  assert.equal(S().settings.warnBeforeClosingLastTab, false);
  assert.equal(S().settings.warnBeforeClosingWindow, true);
  S().updateSettings({ warnBeforeClosingLastTab: true });
  answer = { confirmed: true, suppressed: false };
  await closeTab(tab);
  await settle();
  assert.equal(asks.length, 2);
  assert.equal(S().windows[id], undefined);
});

test("the last tab of a private window closes without the warning", async () => {
  windowWith(["https://a.example/"]);
  const id = S().createWindow({ kind: "private", url: "https://private.example/" });
  asks.length = 0;
  await closeTab(S().windows[id].tabIds[0]);
  await settle();
  assert.equal(asks.length, 0);
  assert.equal(S().windows[id], undefined);
});
