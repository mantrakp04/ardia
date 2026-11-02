import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const model = await import("../browser/model.ts");
const { wokenPage } = await import("../tabs/pageSession.ts");
const { startPinHandoff } = await import("./pinHandoff.ts");
const { flushPersistence, loadSession, startPersistence } = await import("../session/persist.ts");
const stub = await import("../../test-native/index.ts");

const S = () => useBrowser.getState();
const reset = () => S().hydrate({});
const loaded = (id) => !!S().tabs[id]?.page.nav || !!S().tabs[id]?.page.adopt;
const shown = (w) => model.activeTabId(S(), w);
const tileOf = (w, url) => model.viewTabIds(S(), w).find((id) => !!S().tabs[id].pin && S().tabs[id].pinnedUrl === url);
const pages = (url) => Object.values(S().tabs).filter((t) => t.pinnedUrl === url && (t.page.nav || t.page.adopt));

function twoWindows() {
  const a = S().createWindow({ url: "https://mail.com" });
  const [mail] = S().windows[a].tabIds;
  const docs = S().newTab(a, { url: "https://docs.com" });
  S().newTab(a, { url: "https://a.com" });
  S().pinTabs([mail, docs], true);
  S().activate(mail);
  const b = S().createWindow({ url: "https://b.com" });
  return { a, b, mail, docs };
}

test("selecting a pin in B while A holds its page moves the page; A keeps the tab selected, frozen", () => {
  reset();
  const { a, b, mail } = twoWindows();
  S().updateLive(mail, { playingAudio: true });
  const copy = tileOf(b, "https://mail.com");
  S().activate(copy);
  assert.equal(S().tabs[mail].windowId, b, "the page's own tab (same id, same WebContents) is now in B");
  assert.equal(shown(b), mail, "and B shows it");
  assert.equal(tileOf(b, "https://mail.com"), mail, "in B's tile slot");
  assert.equal(S().tabs[copy].windowId, a, "the copy took its place in A");
  assert.equal(shown(a), copy, "A keeps showing that pin, selected");
  assert.equal(S().tabs[copy].page.holderId, mail, "frozen: its page is in B");
  assert.equal(loaded(copy), false, "no second page");
  assert.equal(pages("https://mail.com").length, 1, "one live page for the pin");
  assert.equal(S().live[copy].playingAudio, true, "A's tile shows the same audio state");
});

test("clicking the frozen copy in A pulls the page back; B keeps it frozen", () => {
  reset();
  const { a, b, mail } = twoWindows();
  S().activate(tileOf(b, "https://mail.com"));
  const frozenInA = shown(a);
  S().activate(frozenInA);
  assert.equal(S().tabs[mail].windowId, a, "the page is back in A");
  assert.equal(shown(a), mail);
  assert.equal(S().tabs[frozenInA].windowId, b);
  assert.equal(S().tabs[frozenInA].page.holderId, mail, "B now shows it frozen");
  assert.equal(pages("https://mail.com").length, 1);
});

test("B switching to another tab leaves the page in B until another window asks", () => {
  reset();
  const { a, b, mail } = twoWindows();
  S().activate(tileOf(b, "https://mail.com"));
  const other = model.viewTabIds(S(), b).find((id) => !S().tabs[id].pin);
  S().activate(other);
  assert.equal(S().tabs[mail].windowId, b, "it stays");
  assert.equal(loaded(mail), true);
  assert.equal(S().tabs[shown(a)].page.holderId, mail, "A still shows it frozen");
});

test("closing B while it holds the page returns the page to A in place, no reload", () => {
  reset();
  const { a, b, mail } = twoWindows();
  S().activate(tileOf(b, "https://mail.com"));
  S().closeWindow(b);
  assert.equal(S().tabs[mail].windowId, a, "the same page is back in A");
  assert.equal(shown(a), mail, "shown where the frozen copy was");
  assert.equal(loaded(mail), true);
  assert.equal(Object.values(S().tabs).some((t) => t.page.holderId), false, "nothing frozen is left");
  assert.equal(tileOf(a, "https://mail.com"), mail);
});

test("unloading the pin in either window unloads it everywhere; nothing reloads", () => {
  reset();
  const { a, b, mail } = twoWindows();
  S().activate(tileOf(b, "https://mail.com"));
  const frozen = shown(a);
  S().closeTab(frozen);
  assert.equal(loaded(mail), false, "the page in B is unloaded too");
  assert.equal(loaded(frozen), false);
  assert.equal(S().tabs[frozen].page.holderId, undefined);
  assert.notEqual(shown(a), frozen, "A moved on");
  assert.notEqual(shown(b), mail, "B moved on");
  assert.equal(pages("https://mail.com").length, 0);
});

test("the frozen copy follows the page's title, URL, favicon and audio", () => {
  reset();
  const { a, b, mail } = twoWindows();
  S().activate(tileOf(b, "https://mail.com"));
  S().updateTab(mail, { url: "https://mail.com/inbox/42", title: "Inbox (42)" }, { playingAudio: true, isLoading: false });
  const frozen = S().tabs[shown(a)];
  assert.equal(frozen.title, "Inbox (42)");
  assert.equal(frozen.url, "https://mail.com/inbox/42");
  assert.equal(S().live[frozen.id].playingAudio, true);
});

test("navigating from a frozen copy (address bar, Back to Pinned URL) pulls the page back first", () => {
  reset();
  const { a, b, mail } = twoWindows();
  S().activate(tileOf(b, "https://mail.com"));
  S().updateTab(mail, { url: "https://mail.com/inbox", title: "Inbox" }, {});
  S().returnToPinnedUrl(shown(a));
  assert.equal(S().tabs[mail].windowId, a, "the page came back to A");
  assert.equal(S().tabs[mail].page.nav.url, "https://mail.com", "and navigates home");
  assert.equal(pages("https://mail.com").length, 1);
});

test("Move to Window and Merge All Windows: the holder joins the frozen copy's window and the copy goes", () => {
  reset();
  const { a, b, mail } = twoWindows();
  S().activate(tileOf(b, "https://mail.com"));
  S().mergeAllWindows(a);
  assert.equal(S().tabs[mail].windowId, a);
  assert.equal(tileOf(a, "https://mail.com"), mail, "one tile, the live one");
  assert.equal(model.viewTabIds(S(), a).filter((id) => S().tabs[id].pinnedUrl === "https://mail.com").length, 1);
  assert.equal(shown(a), mail, "A shows the live page where the frozen copy was");
  assert.equal(Object.values(S().tabs).some((t) => t.page.holderId), false);
});

test("a window that gets the pin selected implicitly shows it frozen instead of loading a copy", () => {
  reset();
  const { a, b, mail } = twoWindows();
  const copy = tileOf(b, "https://mail.com");
  const other = shown(b);
  S().activate(copy);
  S().activate(other);
  S().closeTab(other);
  assert.equal(S().tabs[mail].windowId, b);
  const frozen = shown(a);
  assert.equal(S().tabs[frozen].page.holderId, mail);
  assert.equal(pages("https://mail.com").length, 1);
});

test("reopening a closed pinned tile while another window holds the page brings that page over", () => {
  reset();
  const { a, b, mail } = twoWindows();
  S().activate(mail);
  S().closeTab(mail);
  assert.equal(loaded(mail), false);
  const copy = tileOf(b, "https://mail.com");
  S().activate(copy);
  assert.equal(loaded(copy), true, "nobody held it: B loads its own");
  S().reopenClosedTab(a);
  assert.equal(S().tabs[copy].windowId, a, "A takes B's live page instead of restoring a second one");
  assert.equal(pages("https://mail.com").length, 1);
});

test("a pin in a split keeps its own page; private windows have no pins; another profile's pin shares only with itself", () => {
  reset();
  const { a, b, mail } = twoWindows();
  const regular = model.viewTabIds(S(), a).find((id) => !S().tabs[id].pin);
  S().createSplit([mail, regular]);
  const copy = tileOf(b, "https://mail.com");
  S().activate(copy);
  assert.equal(S().tabs[mail].windowId, a, "the split keeps its pane");
  assert.equal(loaded(copy), true, "B loads its own page, as before");
  assert.equal(S().tabs[copy].page.holderId, undefined);

  const p = S().createWindow({ kind: "private", url: "https://secret.com" });
  assert.equal(model.viewTabIds(S(), p).some((id) => !!S().tabs[id].pin), false);

  reset();
  const two = twoWindows();
  const work = S().createProfile({ name: "Work" });
  const w1 = S().createWindow({ profileId: work, url: "https://work.com" });
  const [wt] = S().windows[w1].tabIds;
  S().pinTabs([wt], true);
  S().activate(wt);
  S().switchProfile(two.a, work);
  const workCopy = tileOf(two.a, "https://work.com");
  assert.ok(workCopy, "A paged to Work shows Work's pins");
  S().activate(workCopy);
  assert.equal(S().tabs[wt].windowId, two.a, "Work's page moves into A while A shows Work");
  assert.equal(S().tabs[workCopy].page.holderId, wt, "the Work window shows it frozen");
  assert.equal(S().tabs[two.mail].page.holderId, undefined, "default's pins are untouched");
  assert.equal(loaded(two.mail), true);
});

test("persisted sessions never carry a frozen link; the copy relaunches unloaded", () => {
  stub.docs.clear();
  reset();
  const stop = startPersistence();
  const { a, b } = twoWindows();
  S().activate(tileOf(b, "https://mail.com"));
  const frozen = shown(a);
  flushPersistence();
  stop();
  const saved = JSON.parse(stub.docs.get("session.json"));
  const tab = Array.isArray(saved.tabs) ? saved.tabs.find((t) => t.id === frozen) : saved.tabs?.[frozen];
  assert.ok(tab, "the copy is saved");
  assert.equal(tab.page.holderId, undefined);
  assert.equal(tab.page.kind, "asleep");
  S().hydrate(loadSession());
  assert.ok(S().tabs[frozen].page.holderId, "relaunch: the window focused last loads the pin, the other shows it frozen");
  assert.equal(pages("https://mail.com").length, 1, "one page after relaunch too");
});

test("a slow handoff: the swap runs once, against the state at commit time", async () => {
  reset();
  const { a, b, mail } = twoWindows();
  const stop = startPinHandoff();
  try {
    const copy = tileOf(b, "https://mail.com");
    S().activate(copy);
    assert.equal(S().tabs[mail].windowId, a, "nothing moves before the frame is captured");
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(S().tabs[mail].windowId, b);
    assert.equal(pages("https://mail.com").length, 1);
  } finally {
    stop();
  }
});

test("a background wake of a copy whose page another window holds never makes a second page (relaunch warmup)", () => {
  reset();
  const { a, b, mail } = twoWindows();
  const copy = tileOf(b, "https://mail.com");
  S().updateTab(copy, { page: wokenPage(S().tabs[copy]) });
  assert.equal(pages("https://mail.com").length, 1, "one page");
  assert.equal(S().tabs[copy].page.holderId, mail, "the late wake becomes a frozen copy");
  assert.equal(loaded(mail), true, "the page the user had stays");

  reset();
  const two = twoWindows();
  S().activate(two.docs);
  const other = model.viewTabIds(S(), two.a).find((id) => !S().tabs[id].pin);
  S().activate(other);
  S().closeTab(two.mail);
  const bCopy = tileOf(two.b, "https://mail.com");
  S().activate(bCopy);
  assert.equal(loaded(bCopy), true, "nobody held it: B loads it");
  S().updateTab(two.mail, { page: wokenPage(S().tabs[two.mail]) });
  assert.equal(pages("https://mail.com").length, 1, "A's queued warmup loses to B's page");
  assert.equal(S().tabs[two.mail].page.holderId, bCopy);
});

test("leaving a split hands the pin back to one page", () => {
  reset();
  const { a, b, mail } = twoWindows();
  const regular = model.viewTabIds(S(), a).find((id) => !S().tabs[id].pin);
  const split = S().createSplit([mail, regular]);
  const copy = tileOf(b, "https://mail.com");
  S().activate(copy);
  assert.equal(pages("https://mail.com").length, 2, "a split pane keeps its own page");
  S().separateSplit(split);
  assert.equal(pages("https://mail.com").length, 1, "one page again once the split is gone");
  const [holder] = pages("https://mail.com");
  const other = holder.id === mail ? copy : mail;
  assert.equal(S().tabs[other].page.holderId, holder.id, "the other copy is frozen on it");
});

test("Edit Pinned Page on an unselected copy navigates the one page, wherever it is", () => {
  reset();
  const { a, b, mail } = twoWindows();
  const copy = tileOf(b, "https://mail.com");
  S().setPinnedUrl(copy, "https://mail.com/new");
  assert.equal(pages("https://mail.com/new").length, 1, "one page, at the new URL");
  assert.equal(S().tabs[mail].windowId, a, "it stays in A: B didn't ask to show it");
  assert.equal(S().tabs[mail].page.nav.url, "https://mail.com/new");
  assert.equal(loaded(copy), false);
  assert.equal(S().tabs[copy].pinnedUrl, "https://mail.com/new");
});
