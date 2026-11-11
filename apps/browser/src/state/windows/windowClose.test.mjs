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
const urlsClosedLast = () => S().closedWindows.at(-1).tabs.map((t) => t.url).sort();

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

test("closing the last window asks nothing: it stays restorable from the Dock", async () => {
  const { a, b } = twoWindows();
  await closeByUser(b);
  const dialogs = await closeByUser(a);
  assert.deepEqual(dialogs.map((d) => d.title), []);
  assert.equal(S().windows[a], undefined, "A closed");
  assert.equal(S().closedWindows.at(-1).lastWindow, true, "kept as the last window");
  assert.deepEqual(urlsClosedLast(), ["https://a1.com", "https://a2.com", "https://b1.com"]);
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
  S().hydrate({});
  const a = S().createWindow({ url: "https://a1.com" });
  S().newTab(a, { url: "https://a2.com" });
  S().newTab(a, { url: "https://a3.com" });
  S().createWindow({ url: "https://b1.com" });
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
  const s1 = S().newTab(b, { url: "https://s1.com", background: true });
  const s2 = S().newTab(b, { url: "https://s2.com", background: true });
  S().createSplit([s1, s2]);
  const dialogs = await closeByUser(b);
  assert.deepEqual(dialogs.map((d) => d.title), ["Close 2 tabs?"], "only its split, which stays per window");
  assert.equal(dialogs[0].message, `This window has 2 tabs open in your ${personal()} profile.`);
  assert.equal(S().windows[b], undefined, "B closed");
  assert.equal(listed(a).length, 3);
});

test("with sharing on, a profile no other window shows moves to the open window instead of closing", async () => {
  const { a, b } = twoWindows();
  const work = S().createProfile({ name: "Work" });
  const w1 = S().newTab(b, { url: "https://w1.com", profileId: work, background: true });
  const w2 = S().newTab(b, { url: "https://w2.com", profileId: work, background: true });
  const s1 = S().newTab(b, { url: "https://w3.com", profileId: work, background: true });
  const s2 = S().newTab(b, { url: "https://w4.com", profileId: work, background: true });
  const split = S().createSplit([s1, s2]);
  const group = S().createGroup([w1, w2], { name: "Jobs" });
  assert.equal(listed(a, work).length, 0, "only B has Work tabs");
  const dialogs = await closeByUser(b);
  assert.deepEqual(dialogs.map((d) => d.title), [], "nothing closes, so nothing to ask");
  assert.equal(S().windows[b], undefined, "B closed");
  assert.deepEqual(listed(a, work).sort(), [w1, w2, s1, s2].sort(), "the same tabs, now in A");
  assert.equal(S().groups[group]?.windowId, a, "with their group");
  assert.deepEqual(S().groups[group].tabIds, [w1, w2]);
  assert.equal(S().splits[split]?.windowId, a, "and their split");
  assert.ok(listed(a, work).includes(S().windows[a].activeTabIds[work]), "A remembers a Work tab to show");
  assert.equal(listed(a).length, 3, "A's own tabs untouched");
  assert.ok(!S().closedWindows.some((c) => c.tabs.some((t) => t.url?.startsWith("https://w"))), "not recorded as closed");
});

test("with sharing off, a profile only the closing window shows still closes with it", async () => {
  S().hydrate({});
  const a = S().createWindow({ url: "https://a1.com" });
  const b = S().createWindow({ url: "https://b1.com" });
  const work = S().createProfile({ name: "Work" });
  S().newTab(b, { url: "https://w1.com", profileId: work, background: true });
  S().newTab(b, { url: "https://w2.com", profileId: work, background: true });
  const dialogs = await closeByUser(b);
  assert.deepEqual(dialogs.map((d) => d.title), ["Close 3 tabs?"]);
  assert.equal(S().windows[b], undefined);
  assert.equal(Object.values(S().tabs).filter((t) => t.profileId === work).length, 0);
  assert.equal(S().windows[a].tabIds.length, 1);
});

test("a window already closing doesn't count as open: the next close is the last window's and asks nothing", async () => {
  const { a, b } = twoWindows();
  const gates = [];
  const animateWindowClose = shellNativeModules.ArdiaAppWindows.animateWindowClose;
  shellNativeModules.ArdiaAppWindows.animateWindowClose = () => new Promise((resolve) => gates.push(resolve));
  try {
    assert.deepEqual((await closeByUser(a)).map((d) => d.title), [], "A's tabs stay open in B");
    assert.ok(S().windows[a], "A is still in the store while it animates");
    assert.deepEqual((await closeByUser(b)).map((d) => d.title), [], "B is the last open window");
  } finally {
    gates.splice(0).forEach((resolve) => resolve());
    shellNativeModules.ArdiaAppWindows.animateWindowClose = animateWindowClose;
  }
  await tick();
  await tick();
  assert.equal(Object.keys(S().windows).length, 0);
  assert.equal(S().closedWindows.filter((c) => c.lastWindow).length, 1, "one window to bring back");
  assert.deepEqual(urlsClosedLast(), ["https://a1.com", "https://a2.com", "https://b1.com"], "with every tab");
});

test("a window whose other window closes while its warning is up closes as the last window once confirmed", async () => {
  const { a, b } = twoWindows();
  const s1 = S().newTab(a, { url: "https://w1.com", background: true });
  const s2 = S().newTab(a, { url: "https://w2.com", background: true });
  S().createSplit([s1, s2]);
  const answers = [];
  held = answers;
  try {
    asked.length = 0;
    windows.emit({ type: "closeRequest", id: a });
    await tick();
    assert.deepEqual(asked.map((d) => d.title), ["Close 2 tabs?"], "A asks about its split's two tabs");
    held = null;
    assert.deepEqual((await closeByUser(b)).map((d) => d.title), [], "B's tabs stay open in A, which is still on screen");
    assert.equal(S().windows[b], undefined);
    held = answers;
    answers.shift()();
    await tick();
    await tick();
    assert.deepEqual(asked.map((d) => d.title), [], "A is the last window now, so nothing is lost and it doesn't ask again");
    assert.equal(S().windows[a], undefined, "A closed once confirmed");
    assert.equal(S().closedWindows.at(-1).lastWindow, true);
    assert.equal(S().closedWindows.at(-1).tabs.length, 5, "with the shared three and its split's two");
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

test("⌘W right after moving a window: the frame the native close flushes is the one Reopen Closed Window restores", async () => {
  S().hydrate({});
  S().updateSettings({ warnBeforeClosingLastTab: false });
  const a = S().createWindow({ url: "https://a.com" });
  const b = S().createWindow({ url: "https://b.com" });
  S().setWindowFrame(b, [200, 150, 1100, 700]);
  await withHeldAnimations(async (finish) => {
    void closeTab(S().windows[b].tabIds[0]);
    await tick();
    assert.ok(S().windows[b], "B is still animating out");
    S().setWindowFrame(b, [444, 333, 1100, 700]);
    await finish(b);
  });
  assert.equal(S().windows[b], undefined, "B closed");
  assert.deepEqual(S().closedWindows.at(-1).window.frame, [444, 333, 1100, 700]);
  assert.ok(S().windows[a]);
});
