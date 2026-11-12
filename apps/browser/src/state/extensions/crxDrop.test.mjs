import assert from "node:assert/strict";
import { test } from "node:test";
const native = await import("../../test-native/index.ts");
const { useBrowser } = await import("../browser/store.ts");
const { crxPath, installDroppedCrx, takesCrxDrops } = await import("./crxDrop.ts");

const S = () => useBrowser.getState();

test("a dropped .crx file is an extension to install, any other file or link isn't", () => {
  assert.equal(crxPath("file:///Users/me/Downloads/My%20Ext.crx"), "/Users/me/Downloads/My Ext.crx");
  assert.equal(crxPath("file:///Users/me/ext.CRX"), "/Users/me/ext.CRX");
  assert.equal(crxPath("file:///Users/me/page.html"), null);
  assert.equal(crxPath("https://example.com/ext.crx"), null);
  assert.equal(crxPath("file://host/ext.crx"), null);
});

test("a .crx dropped on a window installs into its profile and opens no tab; the rest still open", async () => {
  S().hydrate({});
  const w = S().createWindow({ url: "a.com" });
  native.installedCrx.length = 0;
  const left = installDroppedCrx(w, ["file:///tmp/one.crx", "https://example.com/", "file:///tmp/page.html"]);
  assert.deepEqual(left, ["https://example.com/", "file:///tmp/page.html"]);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(native.installedCrx.map((x) => x.path), ["/tmp/one.crx"]);
});

test("a private window leaves a dropped .crx alone, as Chrome does", () => {
  S().hydrate({});
  const w = S().createWindow({ url: "a.com", kind: "private" });
  native.installedCrx.length = 0;
  const urls = ["file:///tmp/one.crx"];
  assert.deepEqual(installDroppedCrx(w, urls), urls);
  assert.equal(native.installedCrx.length, 0);
});

test("a regular window takes .crx drops anywhere in it; a private one and a closed one don't", () => {
  S().hydrate({});
  const regular = S().createWindow({ url: "a.com" });
  const hidden = S().createWindow({ url: "a.com", kind: "private" });
  assert.equal(takesCrxDrops(regular), true);
  assert.equal(takesCrxDrops(hidden), false);
  assert.equal(takesCrxDrops("gone"), false);
});

test("a .crx dropped outside the tab list installs and leaves nothing to open", async () => {
  S().hydrate({});
  const w = S().createWindow({ url: "a.com" });
  const tabs = [...S().windows[w].tabIds];
  native.installedCrx.length = 0;
  assert.deepEqual(installDroppedCrx(w, ["file:///tmp/one.crx", "file:///tmp/two.CRX"]), []);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(native.installedCrx.map((x) => x.path), ["/tmp/one.crx", "/tmp/two.CRX"]);
  assert.deepEqual(S().windows[w].tabIds, tabs);
});

test("a failed install says why in the window it was dropped on", async () => {
  S().hydrate({});
  const w = S().createWindow({ url: "a.com" });
  const { useToasts } = await import("../app/toasts.ts");
  native.crxInstallFailure.next = "Package is invalid: 'CRX_SIGNATURE_VERIFICATION_FAILED'.";
  installDroppedCrx(w, ["file:///tmp/bad.crx"]);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(useToasts.getState().toasts[w]?.title, "Couldn't add the extension");
  assert.match(useToasts.getState().toasts[w]?.message ?? "", /CRX_SIGNATURE_VERIFICATION_FAILED/);
});
