import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { POPUP_MEASURE, PopupSizeWaiters, extensionViewEvaluate } from "./hostExtensionScripts.ts";
import { WEB_STORE_REQUEST, WEB_STORE_RETRY_MS, hostPageScript } from "./hostPageScripts.ts";
import { MEASURE_POPUP_SCRIPT } from "../../browser/src/state/extensions/popupSize.ts";
import { useBrowser } from "../../browser/src/state/browser/store.ts";
import { webviews } from "../../browser/src/platform/webviews.ts";
import { startWebStoreIntegration } from "../../browser/src/state/extensions/webStore.ts";

const settled = async (promise) => {
  let state = "pending";
  promise.then(() => (state = "resolved"), () => (state = "rejected"));
  for (let i = 0; i < 5; i++) await Promise.resolve();
  return state;
};

const run = (script, reply) => reply.then(script.map, () => script.failed());

test("the shared Web Store bridge script maps to the native store request and never reaches the page", () => {
  useBrowser.getState().hydrate({});
  const windowId = useBrowser.getState().createWindow({ url: "https://chromewebstore.google.com/detail/x" });
  const sent = [];
  webviews.set(useBrowser.getState().windows[windowId].tabIds[0], { evaluate: (code) => (sent.push(code), new Promise(() => {})) });
  startWebStoreIntegration();
  assert.deepEqual(sent, [WEB_STORE_REQUEST], "the shared Web Store script changed; update hostPageScripts.ts");
  const script = hostPageScript("evaluate", [WEB_STORE_REQUEST]);
  assert.equal(script.command, "webStoreRequest");
  assert.deepEqual(script.args, []);
  assert.equal(hostPageScript("executeJavaScript", [WEB_STORE_REQUEST]), null);
  assert.equal(hostPageScript("evaluate", [WEB_STORE_REQUEST, 1]), null);
});

test("a superseded store wait never settles, so the bridge does not listen again", async () => {
  const script = hostPageScript("evaluate", [WEB_STORE_REQUEST]);
  assert.equal(await settled(run(script, Promise.resolve({ superseded: true }))), "pending");
  assert.equal(await run(script, Promise.resolve("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")), "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(await run(script, Promise.resolve(null)), null, "a page change lets the bridge listen again");
  assert.equal(await run(script, Promise.resolve(7)), null);
});

test("a failed store request answers null only after a delay, so a dead tab cannot spin the bridge", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const script = hostPageScript("evaluate", [WEB_STORE_REQUEST]);
    const answer = run(script, Promise.reject(new Error("No such live tab")));
    assert.equal(await settled(answer), "pending");
    mock.timers.tick(WEB_STORE_RETRY_MS - 1);
    assert.equal(await settled(answer), "pending");
    mock.timers.tick(1);
    assert.equal(await answer, null);
  } finally {
    mock.timers.reset();
  }
});

test("the popup size probe answers from the native preferred size", async () => {
  assert.equal(POPUP_MEASURE, MEASURE_POPUP_SCRIPT, "the shared popup size probe changed; update hostExtensionScripts.ts");
  const sizes = new PopupSizeWaiters();
  let answered = null;
  const first = extensionViewEvaluate(POPUP_MEASURE, sizes).then((size) => (answered = size));
  await Promise.resolve();
  assert.equal(answered, null, "nothing to answer before Chromium reports a size");
  sizes.note({ width: 320, height: 240 });
  assert.deepEqual(await first, { w: 320, h: 240 });
  assert.deepEqual(await extensionViewEvaluate(POPUP_MEASURE, sizes), { w: 320, h: 240 });
  sizes.note({ width: 400, height: 300 });
  assert.deepEqual(await extensionViewEvaluate(POPUP_MEASURE, sizes), { w: 400, h: 300 });
});

test("other popup scripts and a closed popup resolve to nothing", async () => {
  const sizes = new PopupSizeWaiters();
  assert.equal(await extensionViewEvaluate("document.title", sizes), null);
  const pending = extensionViewEvaluate(POPUP_MEASURE, sizes);
  sizes.close();
  assert.equal(await pending, null);
});
