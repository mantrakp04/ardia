import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
globalThis.acTestTabStrip = {
  listen: () => ({ remove() {} }),
  command() {},
  snapshot: () => Promise.resolve({ rev: 0, cmd: null, strips: [] }),
};
const stub = await import("../../test-native/index.ts");
const { ArdiaError } = await import("@ardia/core");
const { useBrowser } = await import("../browser/store.ts");
const fallback = await import("../../lib/fallback.ts");
const { setPeekModifier } = await import("../../platform/pageOptions.ts");
const { setVideoUpscaling } = await import("../../platform/media.ts");
const { startMedia } = await import("../media/pip.ts");
const { startSelectionTools } = await import("../site/selection.ts");
const { startPeeks } = await import("../peek/actions.ts");
const { startChromeTabs } = await import("../tabs/chromeTabs.ts");
const { startLittleArdiaNewTabLinks } = await import("../littleArdia/newTabLinks.ts");

const LINUX_LACKS = [
  "webView.setDisplayMediaPicker",
  "search.setEngineName",
  "webView.setSelectionPopover",
  "webView.setPeekModifier",
  "webView.setSplitLinkModifier",
  "webView.setPeekOtherSiteTabs",
  "media.watchCastRoutes",
  "tabs.strips",
  "webView.setLittleArdiaOpensNewTabLinks",
];
const DOMAIN_MODULES = { webView: "ArdiaWebView", search: "ArdiaSearch", media: "ArdiaMedia", tabs: "ArdiaTabs" };
for (const [domain, module] of Object.entries(DOMAIN_MODULES)) {
  const fake = stub.ardiaCoreNativeModules[module];
  const answer = fake.call;
  fake.call = (verb, profile, json) =>
    LINUX_LACKS.includes(`${domain}.${verb}`)
      ? Promise.reject(Object.assign(new Error("This call is unavailable on Linux"), { code: "ERR_UNKNOWN_CALL" }))
      : answer(verb, profile, json);
}

const unhandled = [];
process.on("unhandledRejection", (reason) => unhandled.push(reason));
const warnings = [];
console.warn = (...args) => void warnings.push(args.join(" "));
const settle = async () => {
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};
const describe = (reason) => `${reason?.name ?? "Error"} ${reason?.code ?? ""} "${reason?.message ?? reason}"`;

test("a host that lacks the launch-time calls gets a warning for each and no unhandled rejection", async () => {
  useBrowser.getState().hydrate({});
  useBrowser.getState().createWindow({ url: "a.com" });
  startMedia();
  startSelectionTools();
  startPeeks();
  startChromeTabs();
  startLittleArdiaNewTabLinks();
  await settle();

  assert.deepEqual(unhandled.map(describe), [], "engine calls the host lacks must not reject unhandled");
  for (const call of LINUX_LACKS) {
    assert.ok(
      warnings.some((w) => w.includes(call) && w.includes("This call is unavailable on Linux")),
      `no warning names ${call}; warnings: ${JSON.stringify(warnings)}`,
    );
  }
});

test("a call the host lacks rejects with the call's name in the error", async () => {
  await assert.rejects(setPeekModifier("off"), (error) => {
    assert.equal(error.code, "ERR_UNKNOWN_CALL");
    assert.equal(error.message, "webView.setPeekModifier: This call is unavailable on Linux");
    return true;
  });
});

test("a host that already names the missing call keeps its own message", async () => {
  const web = stub.ardiaCoreNativeModules.ArdiaWebView;
  const answer = web.call;
  web.call = () => Promise.reject(Object.assign(new Error("webView.setVideoUpscaling isn't a call"), { code: "ERR_UNKNOWN_CALL" }));
  try {
    await assert.rejects(setVideoUpscaling(true), { code: "ERR_UNKNOWN_CALL", message: "webView.setVideoUpscaling isn't a call" });
  } finally {
    web.call = answer;
  }
});

test("only a missing call is tolerated: any other failure still rejects", async () => {
  const missing = new ArdiaError("ERR_UNKNOWN_CALL", "webView.setPeekModifier: This call is unavailable on Linux");
  assert.equal(await Promise.reject(missing).catch(fallback.tolerateMissingCall), undefined);
  assert.match(warnings.at(-1), /^\[engine\] webView\.setPeekModifier: This call is unavailable on Linux$/);
  const failure = new ArdiaError("ERR_ENGINE", "the engine failed");
  await assert.rejects(Promise.reject(failure).catch(fallback.tolerateMissingCall), (error) => error === failure);
  const plain = new TypeError("not an engine error");
  await assert.rejects(Promise.reject(plain).catch(fallback.tolerateMissingCall), (error) => error === plain);
});
