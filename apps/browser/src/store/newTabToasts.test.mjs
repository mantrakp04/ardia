import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

const { useBrowser } = await import("./browser.ts");
const { activeTabId } = await import("./model.ts");
const { createNewTabToasts, newTabToasts, newTabToastCapacity, visibleNewTabToasts } = await import("./newTabToasts.ts");
const S = () => useBrowser.getState();
const notices = () => newTabToasts.useStore.getState().items;

beforeEach(() => S().hydrate({}));

function fakeTime() {
  let now = 0;
  let next = 0;
  const jobs = new Map();
  return {
    jobs,
    now: () => now,
    set: (run, delay) => {
      const id = ++next;
      jobs.set(id, { at: now + delay, run });
      return id;
    },
    clear: (id) => jobs.delete(id),
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const due = [...jobs].filter(([, job]) => job.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, job] = due;
        now = job.at;
        jobs.delete(id);
        job.run();
      }
      now = until;
    },
  };
}

test("one committed tab makes one notice, including multiple background links without switching the page", () => {
  const w = S().createWindow({ url: "https://example.com/" });
  const opener = activeTabId(S(), w);
  assert.deepEqual(notices(), []);
  const a = S().newTab(w, { url: "https://example.org/a", background: true, openerId: opener });
  const b = S().newTab(w, { url: "https://example.org/b", background: true, openerId: opener });
  assert.deepEqual(notices().map((t) => t.tabId), [a, b]);
  assert.equal(activeTabId(S(), w), opener);
  newTabToasts.add(S().tabs[a]);
  assert.equal(notices().length, 2);
  assert.equal(S().newTab("missing"), "");
  assert.equal(notices().length, 2);
  S().navigate(a, "https://example.org/c");
  assert.equal(notices().length, 2);
});

test("the default clock invokes global timers with their global receiver", () => {
  const time = fakeTime();
  const originalSet = globalThis.setTimeout;
  const originalClear = globalThis.clearTimeout;
  let q;
  try {
    globalThis.setTimeout = function (run, ms) {
      assert.equal(this, globalThis);
      return time.set(run, ms);
    };
    globalThis.clearTimeout = function (timer) {
      assert.equal(this, globalThis);
      time.clear(timer);
    };
    q = createNewTabToasts();
    q.add({ id: "a", windowId: "w", profileId: "p" });
    q.present("a");
    time.advance(5000);
    assert.deepEqual(q.useStore.getState().items, []);
    q.add({ id: "b", windowId: "w", profileId: "p" });
    q.present("b");
    q.remove("b");
    assert.equal(time.jobs.size, 0);
  } finally {
    try { q?.clear(); } finally {
      globalThis.setTimeout = originalSet;
      globalThis.clearTimeout = originalClear;
    }
  }
});

test("a new-tab command keeps upstream beside-current placement and announces its actual id once", () => {
  const w = S().createWindow({ url: "https://example.com/" });
  const first = activeTabId(S(), w);
  S().newTab(w, { url: "https://example.org/", notify: false });
  S().activate(first);
  S().updateSettings({ newTabPosition: "nextToCurrent" });
  const id = S().newTab(w, { newTabCommand: true });
  assert.deepEqual(S().windows[w].tabIds.slice(0, 2), [first, id]);
  assert.deepEqual(notices().map((t) => t.tabId), [id]);
  assert.equal(activeTabId(S(), w), id);
});

test("a manually reopened window announces its restored page without announcing passive parked pins", () => {
  const w = S().createWindow({ url: "https://example.com/" });
  const pin = S().newTab(w, { url: "https://example.org/pin", pinned: true, background: true, notify: false });
  S().closeWindow(w);
  assert.ok(S().parkedPins.default.tabs.some((t) => t.id === pin));
  assert.deepEqual(notices(), []);
  S().reopenClosedWindow();
  assert.equal(S().tabs[pin].unloaded, true);
  assert.equal(notices().length, 1);
  assert.equal(S().tabs[notices()[0].tabId].url, "https://example.com/");
  assert.ok(notices().every((t) => !S().tabs[t.tabId].unloaded));
  newTabToasts.add(S().tabs[pin]);
  assert.equal(notices().length, 1);
});

test("user duplication, group tabs, nested groups and fresh split panes announce only the actual new ids", () => {
  const w = S().createWindow({ url: "https://example.com/" });
  const first = activeTabId(S(), w);
  const second = S().newTab(w, { url: "https://example.org/", notify: false });
  const group = S().groupTabs([first, second], { pinned: false });
  const duplicate = S().duplicateTab(first);
  const grouped = S().newTabInGroup(group);
  const nested = S().newNestedGroup(group);
  const nestedTab = S().groups[nested].tabIds[0];
  const copy = S().duplicateGroup(group);
  const copies = S().groups[copy].tabIds;
  assert.deepEqual(notices().map((t) => t.tabId), [duplicate, grouped, nestedTab, ...copies]);
  const existing = S().openSplitPane(w, { anchorTabId: first, tabId: second });
  assert.equal(existing.ok, true);
  const count = notices().length;
  const made = S().openSplitPane(w, { anchorTabId: first, url: "https://example.net/" });
  assert.equal(made.ok, true);
  assert.equal(notices().length, count + 1);
  assert.equal(notices().at(-1).tabId, made.tabId);
  assert.equal(S().openSplitPane(w, { anchorTabId: first }).ok, false);
  assert.equal(notices().length, count + 1);
});

test("technical initial tabs, profile fallback, onboarding pins and session hydration stay silent", async () => {
  const w = S().createWindow();
  const work = S().createProfile({ name: "Work" });
  S().switchProfile(w, work);
  S().deleteProfile(work);
  S().newTab(w, { url: "about:blank#technical", notify: false });
  const { pinSites } = await import("../components/onboarding/sites.ts");
  pinSites(w, ["github", "gmail"]);
  assert.deepEqual(notices(), []);
  const id = S().newTab(w, { url: "https://example.com/" });
  assert.equal(notices()[0].tabId, id);
  const saved = { windows: S().windows, windowOrder: S().windowOrder, tabs: S().tabs, profiles: S().profiles, profileOrder: S().profileOrder };
  S().hydrate(saved);
  assert.ok(S().tabs[id]);
  assert.deepEqual(notices(), []);
});

test("imported tabs and extension-store import openings do not announce user-created tabs", async () => {
  const { importTabs, openInWebStore } = await import("../components/import/apply.ts");
  const w = S().createWindow();
  assert.equal(importTabs("default", [{ url: "https://example.org/imported", title: "Imported", pinned: false }], "Imported"), 1);
  openInWebStore("default", ["https://example.net/imported-extension"]);
  assert.ok(S().windows[w].tabIds.length >= 3);
  assert.deepEqual(notices(), []);
});

test("Little Ardia redirects a user-created tab to a new main window and announces it once", () => {
  const little = S().createWindow({ small: true, url: "https://example.com/" });
  const id = S().newTab(little, { url: "https://example.org/", background: true });
  assert.ok(S().tabs[id]);
  assert.notEqual(S().tabs[id].windowId, little);
  assert.deepEqual(notices().map((t) => t.tabId), [id]);
});

test("Peek stays silent until promoted to a normal tab, including promotion into a split", () => {
  const w = S().createWindow({ url: "https://example.com/" });
  const source = activeTabId(S(), w);
  const preview = S().openPeek(source, "https://example.org/preview");
  assert.ok(preview);
  assert.deepEqual(notices(), []);
  assert.equal(S().peekToTab(w, { activate: false }), preview);
  assert.deepEqual(notices().map((t) => t.tabId), [preview]);
  assert.equal(S().openSplitPane(w, { anchorTabId: source, tabId: preview }).ok, true);
  assert.equal(S().peekToTab(w), undefined);
  assert.deepEqual(notices().map((t) => t.tabId), [preview]);
});

test("a manual reopen announces its new id while a moved existing tab does not create another notice", () => {
  const a = S().createWindow({ url: "https://example.com/" });
  const b = S().createWindow({ url: "https://example.org/" });
  const id = S().newTab(a, { url: "https://example.net/" });
  S().closeTab(id);
  assert.deepEqual(notices(), []);
  S().reopenClosedTab(a);
  const reopened = activeTabId(S(), a);
  assert.notEqual(reopened, id);
  assert.deepEqual(notices().map((t) => t.tabId), [reopened]);
  S().moveTabsToWindow([reopened], b);
  assert.deepEqual(notices(), []);
});

test("each notice expires five seconds from its first appearance without restarting on another arrival or remount", () => {
  const time = fakeTime();
  const q = createNewTabToasts(time);
  const items = () => q.useStore.getState().items;
  q.add({ id: "a", windowId: "w", profileId: "p" });
  q.present("a");
  time.advance(2000);
  q.add({ id: "b", windowId: "w", profileId: "p" });
  q.present("b");
  q.present("a");
  time.advance(2820);
  assert.equal(items().find((t) => t.tabId === "a").leaving, true);
  assert.equal(items().find((t) => t.tabId === "b").leaving, false);
  time.advance(180);
  assert.deepEqual(items().map((t) => t.tabId), ["b"]);
  time.advance(2000);
  assert.deepEqual(items(), []);
  assert.equal(time.jobs.size, 0);
});

test("overflow, an obscuring pane and another profile defer the first appearance without losing queued notices", () => {
  const time = fakeTime();
  const q = createNewTabToasts(time);
  for (const id of ["a", "b", "c"]) q.add({ id, windowId: "w", profileId: "p" });
  q.add({ id: "other", windowId: "other", profileId: "p" });
  const items = () => q.useStore.getState().items;
  assert.equal(newTabToastCapacity(0), 0);
  assert.deepEqual(visibleNewTabToasts(items(), "w", "p", 100, true), []);
  assert.deepEqual(visibleNewTabToasts(items(), "w", "p", 100, false, 197), []);
  assert.equal(visibleNewTabToasts(items(), "w", "p", 100, false, 198).length, 1);
  assert.deepEqual(visibleNewTabToasts(items(), "w", "other-profile", 100), []);
  time.advance(10000);
  assert.equal(time.jobs.size, 0);
  const visible = visibleNewTabToasts(items(), "w", "p", 100);
  assert.deepEqual(visible.map((t) => t.tabId), ["a"]);
  q.present(visible[0].tabId);
  time.advance(5000);
  assert.deepEqual(visibleNewTabToasts(items(), "w", "p", 100).map((t) => t.tabId), ["b"]);
  assert.equal(items().find((t) => t.tabId === "b").appearedAt, null);
  q.clear();
});

test("page permission and security prompts defer the production toast selection", async () => {
  const { newTabToastPrompt } = await import("../components/layout/newTabToastProtection.ts");
  const { patchPage, usePages } = await import("../components/layout/pageState.ts");
  const w = S().createWindow();
  const id = activeTabId(S(), w);
  const toast = S().newTab(w, { background: true });
  for (const key of ["permission", "passwordPrompt", "autofillPrompt", "externalApp"]) {
    patchPage(id, { [key]: { id: "request" } });
    const blocked = newTabToastPrompt(usePages.getState().pages[id], null);
    assert.equal(blocked, true, key);
    assert.deepEqual(visibleNewTabToasts(notices(), w, "default", 200, blocked), []);
    assert.equal(notices().find((t) => t.tabId === toast).appearedAt, null);
    patchPage(id, { [key]: null });
  }
  assert.equal(newTabToastPrompt(usePages.getState().pages[id], "siteControls"), true);
  assert.equal(newTabToastPrompt(usePages.getState().pages[id], null), false);
});

test("clicking activates the associated existing tab, validates scope, and never recreates a closed tab", () => {
  const w = S().createWindow({ url: "https://example.com/" });
  const a = S().newTab(w, { url: "https://example.org/a", background: true });
  const b = S().newTab(w, { url: "https://example.org/b", background: true });
  newTabToasts.activate(a, "wrong-window", "default", S());
  assert.equal(notices().length, 2);
  newTabToasts.activate(a, w, "default", S());
  assert.equal(activeTabId(S(), w), a);
  assert.deepEqual(notices().map((t) => t.tabId), [b]);
  S().closeTab(b);
  const ids = Object.keys(S().tabs);
  newTabToasts.activate(b, w, "default", S());
  assert.deepEqual(Object.keys(S().tabs), ids);
  assert.deepEqual(notices(), []);
});

test("closing windows, unloading pinned tabs and disposing queues clean their independent timers", () => {
  const time = fakeTime();
  const q = createNewTabToasts(time);
  const w = S().createWindow();
  const a = S().newTab(w, { url: "https://example.org/a", pinned: true });
  q.add(S().tabs[a]);
  q.present(a);
  S().closeTab(a);
  q.prune(S());
  assert.equal(time.jobs.size, 0);
  const b = S().newTab(w, { url: "https://example.org/b" });
  q.add(S().tabs[b]);
  q.present(b);
  S().closeWindow(w);
  q.prune(S());
  assert.deepEqual(q.useStore.getState().items, []);
  assert.equal(time.jobs.size, 0);
  q.add({ id: "c", windowId: "w", profileId: "p" });
  q.present("c");
  q.clear();
  time.advance(10000);
  assert.equal(time.jobs.size, 0);
  assert.deepEqual(q.useStore.getState().items, []);
});
