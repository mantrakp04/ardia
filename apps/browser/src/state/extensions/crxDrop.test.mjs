import assert from "node:assert/strict";
import { test } from "node:test";
const native = await import("../../test-native/index.ts");
const { useBrowser } = await import("../browser/store.ts");
const { crxPath, installDroppedCrx } = await import("./crxDrop.ts");

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
  const w = S().createWindow({ url: "a.com", incognito: true });
  native.installedCrx.length = 0;
  const urls = ["file:///tmp/one.crx"];
  assert.deepEqual(installDroppedCrx(w, urls), urls);
  assert.equal(native.installedCrx.length, 0);
});
