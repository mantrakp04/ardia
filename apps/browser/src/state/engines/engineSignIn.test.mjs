import assert from "node:assert/strict";
import { test } from "node:test";

const imports = [];
const storeKeys = [];
const webKitCalls = {
  endPrivateSession: () => null,
  cookieStoreKey: ({ profile }) => (storeKeys.push(profile), profile),
  importCookies: ({ profile, storeKey, cookies }) => (imports.push({ profile, key: storeKey, cookies }), cookies.length),
};
globalThis.acTestNativeModules = {
  ArdiaWebKit: {
    addListener: () => ({ remove() {} }),
    call: async (name, profile, json) => JSON.stringify(webKitCalls[name]({ ...JSON.parse(json), profile }) ?? null),
  },
};

const { launch } = await import("../../test-native/shell.ts");
launch.switches.webkitSignIn = true;
const { useBrowser } = await import("../browser/store.ts");
const model = await import("../browser/model.ts");
const { webviews } = await import("../../platform/webviews.ts");
const { carrySignInToWebKit } = await import("./engineSignIn.ts");

const S = () => useBrowser.getState();
const cookie = { name: "NetflixId", value: "v", domain: ".video.example", path: "/", expires: -1, session: true, httpOnly: true, secure: true };

function pageWithCookies() {
  let answer;
  const pending = new Promise((resolve) => (answer = resolve));
  return { handle: { pageCookies: () => pending }, answer: () => answer([cookie]) };
}

test("the default profile's cookies go to its WebKit store, whose key is the empty string", async () => {
  S().hydrate({});
  imports.length = 0;
  const w = S().createWindow({ url: "https://video.example/title/1" });
  const tabId = model.activeTabId(S(), w);
  const page = pageWithCookies();
  webviews.set(tabId, page.handle);
  const carried = carrySignInToWebKit(tabId, "https://video.example/title/1");
  page.answer();
  assert.equal(await carried, 1);
  assert.deepEqual(imports.map((i) => [i.profile, i.key, i.cookies.length]), [["", "", 1]]);
  webviews.clear();
});

test("closing the private window while the cookies are read imports nothing", async () => {
  S().hydrate({});
  imports.length = 0;
  const w = S().createWindow({ kind: "private", url: "https://video.example/title/1" });
  const tabId = model.activeTabId(S(), w);
  const page = pageWithCookies();
  webviews.set(tabId, page.handle);
  const carried = carrySignInToWebKit(tabId, "https://video.example/title/1");
  await Promise.resolve();
  S().closeWindow(w);
  page.answer();
  assert.equal(await carried, 0);
  assert.deepEqual(imports, []);
  webviews.clear();
});

test("a tab that moved to another profile while the cookies were read imports nothing", async () => {
  S().hydrate({});
  imports.length = 0;
  const w = S().createWindow({ url: "https://music.example/" });
  const tabId = model.activeTabId(S(), w);
  const page = pageWithCookies();
  webviews.set(tabId, page.handle);
  const carried = carrySignInToWebKit(tabId, "https://music.example/");
  await Promise.resolve();
  S().updateTab(tabId, { profileId: "work" });
  page.answer();
  assert.equal(await carried, 0);
  assert.deepEqual(imports, []);
  webviews.clear();
});
