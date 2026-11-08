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
let answer = true;
let held = null;
shellNativeModules.ArdiaDialogs.confirm = (options) => {
  asked.push(options);
  if (held) return new Promise((resolve) => held.push(() => resolve({ confirmed: true, suppressed: false })));
  return Promise.resolve({ confirmed: answer, suppressed: false });
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

test("cancelling the warning keeps the window and every tab", async () => {
  const { a, b } = twoWindows();
  await closeByUser(b);
  answer = false;
  try {
    assert.deepEqual((await closeByUser(a)).map((d) => d.title), ["Close 3 tabs?"]);
  } finally {
    answer = true;
  }
  assert.ok(S().windows[a], "A stays open");
  assert.equal(listed(a).length, 3, "with all three tabs");
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

test("a window already closing keeps no copies: the next close asks about the tabs only it still holds", async () => {
  const { a, b } = twoWindows();
  const gates = [];
  const animateWindowClose = shellNativeModules.ArdiaAppWindows.animateWindowClose;
  shellNativeModules.ArdiaAppWindows.animateWindowClose = () => new Promise((resolve) => gates.push(resolve));
  try {
    assert.deepEqual((await closeByUser(a)).map((d) => d.title), [], "A's tabs stay open in B");
    assert.ok(S().windows[a], "A is still in the store while it animates");
    const dialogs = await closeByUser(b);
    assert.deepEqual(dialogs.map((d) => d.title), ["Close 3 tabs?"]);
    assert.equal(dialogs[0].message, `This window has 3 tabs open in your ${personal()} profile.`);
  } finally {
    gates.splice(0).forEach((resolve) => resolve());
    shellNativeModules.ArdiaAppWindows.animateWindowClose = animateWindowClose;
  }
  await tick();
});

test("a window whose shared tabs lose their other window while its warning is up asks again before closing them", async () => {
  const { a, b } = twoWindows();
  const work = S().createProfile({ name: "Work" });
  S().newTab(a, { url: "https://w1.com", profileId: work, background: true });
  S().newTab(a, { url: "https://w2.com", profileId: work, background: true });
  const answers = [];
  held = answers;
  try {
    asked.length = 0;
    windows.emit({ type: "closeRequest", id: a });
    await tick();
    assert.deepEqual(asked.map((d) => d.title), ["Close 2 tabs?"], "A asks about its two Work tabs");
    held = null;
    assert.deepEqual((await closeByUser(b)).map((d) => d.title), [], "B's tabs stay open in A, which is still on screen");
    assert.equal(S().windows[b], undefined);
    held = answers;
    answers.shift()();
    await tick();
    await tick();
    assert.deepEqual(asked.map((d) => d.title), ["Close 5 tabs?"], "confirming A now loses the shared three too, so it asks again");
    assert.ok(S().windows[a], "A waits for that answer");
    answers.shift()();
    await tick();
    await tick();
    assert.equal(S().windows[a], undefined, "A closed once confirmed");
  } finally {
    held = null;
    answers.splice(0).forEach((resolve) => resolve());
  }
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

async function withHeldAnimations(run) {
  const gates = new Map();
  const animateWindowClose = shellNativeModules.ArdiaAppWindows.animateWindowClose;
  shellNativeModules.ArdiaAppWindows.animateWindowClose = (id) => new Promise((resolve) => gates.set(id, resolve));
  const finish = async (id) => {
    gates.get(id)();
    gates.delete(id);
    await tick();
    await tick();
  };
  try {
    await run(finish);
  } finally {
    [...gates.values()].forEach((resolve) => resolve());
    shellNativeModules.ArdiaAppWindows.animateWindowClose = animateWindowClose;
    await tick();
  }
}

const urlsClosedLast = () => S().closedWindows.at(-1).tabs.map((t) => t.url).sort();

for (const order of ["first", "second"]) {
  test(`closing two windows that share tabs closes both when the ${order} one's animation ends first`, async () => {
    const { a, b } = twoWindows();
    const closedBefore = S().closedWindows.length;
    await withHeldAnimations(async (finish) => {
      await closeByUser(a);
      await closeByUser(b);
      assert.ok(S().windows[a] && S().windows[b], "both still animate");
      const [x, y] = order === "first" ? [a, b] : [b, a];
      await finish(x);
      assert.equal(S().windows[x], undefined, `${x} closed`);
      await finish(y);
      assert.equal(S().windows[y], undefined, `${y} closed too`);
    });
    assert.equal(Object.keys(S().windows).length, 0);
    assert.equal(S().closedWindows.length, closedBefore + 1, "one closed window to reopen");
    assert.deepEqual(urlsClosedLast(), ["https://a1.com", "https://a2.com", "https://b1.com"], "it holds every tab");
  });
}

test("a closing window that gains a new tab before its animation ends stays open and is focused", async () => {
  const { a, b } = twoWindows();
  await withHeldAnimations(async (finish) => {
    await closeByUser(a);
    windows.focused = b;
    S().newTab(a, { url: "https://late.com" });
    await finish(a);
    assert.ok(S().windows[a], "A stays open");
    assert.equal(windows.focused, a, "and comes forward");
    assert.ok(listed(a).some((id) => S().tabs[id].url === "https://late.com"));
  });
});

test("a closing window that gains a second row of a tab it already shows stays open", async () => {
  S().hydrate({});
  const a = S().createWindow({ url: "https://mail.com" });
  const [mail] = S().windows[a].tabIds;
  S().newTab(a, { url: "https://a.com" });
  S().pinTabs([mail], true);
  S().activate(mail);
  const regular = S().windows[a].tabIds.find((id) => !S().tabs[id].pin);
  S().createSplit([mail, regular]);
  const b = S().createWindow({ url: "https://b.com" });
  const copy = S().windows[b].tabIds.find((id) => S().tabs[id].pin);
  S().activate(copy);
  await withHeldAnimations(async (finish) => {
    await closeByUser(b);
    windows.focused = a;
    S().moveTabsToWindow([mail], b);
    assert.equal(S().tabs[mail].windowId, b, "the moved page is a row of its own in B");
    await finish(b);
    assert.ok(S().windows[b], "B stays open");
    assert.equal(windows.focused, b, "and comes forward");
    assert.ok(S().tabs[mail] && S().tabs[copy], "with both of its pages");
  });
});
