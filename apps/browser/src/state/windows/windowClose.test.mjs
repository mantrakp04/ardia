import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { profileFor } = await import("../browser/model.ts");
const { startWindowCloseGuard } = await import("./windowClose.ts");
const { closeTab } = await import("../browser/actions.ts");
const { shellNativeModules, windows } = await import("../../test-native/shell.ts");

const S = () => useBrowser.getState();
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const share = (on) => S().updateSettings({ shareTabsAcrossWindows: on });
const listed = (w, profileId = S().windows[w].profileId) => S().windows[w].tabIds.filter((id) => S().tabs[id].profileId === profileId);
const personal = () => profileFor(S(), "default").name;

const asked = [];
shellNativeModules.ArdiaDialogs.confirm = (options) => {
  asked.push(options);
  return Promise.resolve({ confirmed: true, suppressed: false });
};
startWindowCloseGuard();

async function closeByUser(id) {
  asked.length = 0;
  windows.emit({ type: "closeRequest", id });
  await tick();
  await tick();
  return asked.slice();
}

function twoWindows() {
  S().hydrate({});
  const a = S().createWindow({ url: "https://a1.com" });
  S().newTab(a, { url: "https://a2.com" });
  const b = S().createWindow({ url: "https://b1.com" });
  share(true);
  return { a, b };
}

test("closing a second window whose tabs all stay open in the first asks nothing", async () => {
  const { a, b } = twoWindows();
  assert.equal(listed(b).length, 3, "B lists the profile's three tabs");
  const dialogs = await closeByUser(b);
  assert.deepEqual(dialogs.map((d) => d.title), []);
  assert.equal(S().windows[b], undefined, "B closed");
  assert.equal(listed(a).length, 3, "A still has all three");
});

test("closing the last window asks about every tab it loses", async () => {
  const { a, b } = twoWindows();
  await closeByUser(b);
  const dialogs = await closeByUser(a);
  assert.deepEqual(dialogs.map((d) => d.title), ["Close 3 tabs?"]);
  assert.equal(dialogs[0].message, `This window has 3 tabs open in your ${personal()} profile.`);
  assert.equal(S().windows[a], undefined, "A closed");
});

test("with sharing off every window still asks about its own tabs", async () => {
  S().hydrate({});
  const a = S().createWindow({ url: "https://a1.com" });
  S().newTab(a, { url: "https://a2.com" });
  S().newTab(a, { url: "https://a3.com" });
  S().createWindow({ url: "https://b1.com" });
  assert.equal(S().settings.shareTabsAcrossWindows, false);
  const dialogs = await closeByUser(a);
  assert.deepEqual(dialogs.map((d) => d.title), ["Close 3 tabs?"]);
  assert.equal(dialogs[0].message, `This window has 3 tabs open in your ${personal()} profile.`);
  assert.equal(dialogs[0].confirmTitle, "Close All Tabs");
});

test("with sharing on, a window asks only about the tabs that close with it", async () => {
  const { a, b } = twoWindows();
  const work = S().createProfile({ name: "Work" });
  S().newTab(b, { url: "https://w1.com", profileId: work, background: true });
  S().newTab(b, { url: "https://w2.com", profileId: work, background: true });
  assert.equal(listed(a, work).length, 0, "only B has Work tabs");
  const dialogs = await closeByUser(b);
  assert.deepEqual(dialogs.map((d) => d.title), ["Close 2 tabs?"]);
  assert.equal(dialogs[0].message, "This window has 2 tabs open in your Work profile.");
  assert.equal(S().windows[b], undefined, "B closed");
  assert.equal(listed(a).length, 3);
});

test("closing a window's last tab still asks about the tabs of its window", async () => {
  S().hydrate({});
  const a = S().createWindow({ url: "https://a1.com" });
  S().createWindow({ url: "https://b1.com" });
  const [tab] = S().windows[a].tabIds;
  asked.length = 0;
  await closeTab(tab);
  assert.deepEqual(asked.map((d) => d.title), ["Close 1 tab?"]);
  assert.equal(asked[0].message, `This window has 1 tab open in your ${personal()} profile.`);
});
