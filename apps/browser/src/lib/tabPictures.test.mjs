import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../store/browser.ts");
const { webviews } = await import("./webviews.ts");
const { rememberPicture, lastPicture } = await import("./tabPictures.ts");

const S = () => useBrowser.getState();

test("a private window's tab is never snapshotted, even on request", async () => {
  S().hydrate({});
  const normal = S().createWindow({ url: "https://a.example/" });
  const secret = S().createWindow({ incognito: true, url: "https://b.example/" });
  const tabOf = (w) => S().windows[w].activeTabIds[S().windows[w].profileId];
  let shots = 0;
  const view = { capturePicture: async () => (shots++, { data: "x", frame: [0, 0, 1, 1] }) };
  webviews.set(tabOf(normal), view);
  webviews.set(tabOf(secret), view);
  await rememberPicture(tabOf(secret));
  assert.equal(shots, 0);
  assert.equal(lastPicture(tabOf(secret)), null);
  await rememberPicture(tabOf(normal));
  assert.equal(shots, 1);
  assert.ok(lastPicture(tabOf(normal)));
});
