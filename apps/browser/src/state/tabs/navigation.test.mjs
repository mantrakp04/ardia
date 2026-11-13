import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { activeTabId, IDLE_LIVE } = await import("../browser/model.ts");
const { canGoBack, goBack } = await import("./navigation.ts");
const { openLinkInSplit } = await import("../splits/actions.ts");
await import("../../test-native/index.ts");

const S = () => useBrowser.getState();
const live = (id) => S().live[id] ?? IDLE_LIVE;
const shown = (w) => activeTabId(S(), w);

function windowWith(host) {
  S().hydrate({});
  S().updateSettings({ cmdClickCreatesTabGroup: false, newTabPosition: "bottom" });
  const w = S().createWindow({ url: `https://${host}.com/` });
  return { w, a: S().windows[w].tabIds[0] };
}

test("back on a tab opened in front from a link, with no history of its own, closes it and shows the opener", () => {
  const { w, a } = windowWith("a");
  const b = S().newTab(w, { url: "https://b.com/", openerId: a, background: false });
  assert.equal(shown(w), b);
  assert.equal(live(b).canGoBack, false);
  assert.equal(canGoBack(b, live(b)), true, "back is offered even though the page cannot go back");
  const closed = S().closedTabs.length;
  goBack(b);
  assert.equal(S().tabs[b], undefined, "the tab closed");
  assert.equal(shown(w), a, "the opener is shown");
  assert.equal(S().closedTabs.length, closed + 1, "the closed tab is recorded, so reopen brings it back");
  assert.equal(S().closedTabs.at(-1).tab.url, "https://b.com/");
});

test("back on a tab opened behind from a link, then switched to, closes it and shows the opener", () => {
  const { w, a } = windowWith("a");
  const b = S().newTab(w, { url: "https://b.com/", openerId: a, background: true });
  assert.equal(shown(w), a);
  S().activate(b);
  assert.equal(canGoBack(b, live(b)), true);
  goBack(b);
  assert.equal(S().tabs[b], undefined);
  assert.equal(shown(w), a);
});

test("back on a tab with no opener and no history does nothing", () => {
  const { w, a } = windowWith("a");
  assert.equal(canGoBack(a, live(a)), false);
  goBack(a);
  assert.ok(S().tabs[a]);
  assert.equal(shown(w), a);
});

test("back on a tab a link opened goes back in the page when the page has history", () => {
  const { w, a } = windowWith("a");
  const b = S().newTab(w, { url: "https://b.com/", openerId: a, background: false });
  S().updateTab(b, {}, { canGoBack: true });
  assert.equal(live(b).canGoBack, true);
  goBack(b);
  assert.ok(S().tabs[b], "the tab stays: the page went back instead");
  assert.equal(shown(w), b);
});

test("back does not close a pinned tab, even one a link opened", () => {
  const { w, a } = windowWith("a");
  const b = S().newTab(w, { url: "https://b.com/", openerId: a, background: false });
  S().pinTabs([b], true);
  assert.equal(canGoBack(b, live(b)), false);
  goBack(b);
  assert.ok(S().tabs[b], "the pinned tab stays");
});

test("back on a Peek with no history of its own ends the Peek and shows the tab it was opened from", () => {
  const { w, a } = windowWith("a");
  const peek = S().openPeek(a, "https://peek.example/");
  assert.ok(peek);
  assert.equal(live(peek).canGoBack, false);
  assert.equal(canGoBack(peek, live(peek)), true, "back is offered even though the Peek's page cannot go back");
  const closed = S().closedTabs.length;
  goBack(peek);
  assert.equal(S().peeks[w], undefined, "the Peek ended");
  assert.equal(S().tabs[peek], undefined, "its page is thrown away");
  assert.equal(shown(w), a, "the tab it was opened from is shown");
  assert.equal(S().closedTabs.length, closed, "a Peek leaves no closed-tab record");
});

test("back on a Peek whose page has history goes back in the page, and the Peek stays", () => {
  const { w, a } = windowWith("a");
  const peek = S().openPeek(a, "https://peek.example/");
  S().updateTab(peek, {}, { canGoBack: true });
  assert.equal(live(peek).canGoBack, true);
  goBack(peek);
  assert.ok(S().peeks[w], "the Peek stays: its page went back instead");
  assert.ok(S().tabs[peek]);
});

test("back on a Peek opened from a pinned tab ends the Peek and leaves the pin alone", () => {
  const { w, a } = windowWith("a");
  S().pinTabs([a], true);
  const peek = S().openPeek(a, "https://peek.example/");
  assert.ok(peek);
  goBack(peek);
  assert.equal(S().peeks[w], undefined);
  assert.ok(S().tabs[a], "the pinned tab stays");
});

test("back on the first of two links opened behind returns to the opener, not to the other link", () => {
  const { w, a } = windowWith("a");
  const b = S().newTab(w, { url: "https://b.com/", openerId: a, background: true });
  const c = S().newTab(w, { url: "https://c.com/", openerId: a, background: true });
  S().activate(b);
  assert.equal(canGoBack(b, live(b)), true);
  goBack(b);
  assert.equal(S().tabs[b], undefined, "the tab closed");
  assert.equal(shown(w), a, "the opener is shown, not the sibling link");
  assert.ok(S().tabs[c], "the other link stays open");
});

test("back is not offered on a tab opened by hand beside the current one, once it has a page", () => {
  const { w, a } = windowWith("a");
  S().updateSettings({ newTabPosition: "nextToCurrent" });
  const b = S().newTab(w, { newTabCommand: true });
  assert.equal(S().tabs[b].openerId, a, "placement still records the tab it sits beside, for ordinary close");
  assert.equal(S().tabs[b].linkOpenerId, undefined, "but a placement hint is not a link opening");
  S().navigate(b, "https://typed.example/");
  assert.equal(live(b).canGoBack, false);
  assert.equal(canGoBack(b, live(b)), false, "back stays off: the page is the first one this tab has shown");
  goBack(b);
  assert.ok(S().tabs[b], "the tab stays");
  assert.equal(shown(w), b);
});

test("back on a Peek expanded into a tab closes it and shows the tab it was opened from", () => {
  const { w, a } = windowWith("a");
  const peek = S().openPeek(a, "https://peek.example/");
  const promoted = S().peekToTab(w);
  assert.equal(promoted, peek);
  assert.equal(S().tabs[peek].linkOpenerId, a, "expanding a Peek keeps which tab opened it");
  assert.equal(canGoBack(peek, live(peek)), true);
  goBack(peek);
  assert.equal(S().tabs[peek], undefined, "the tab closed");
  assert.equal(shown(w), a, "the tab it was opened from is shown");
});

test("back does nothing on a link-opened tab whose opener closed, even when its opener's opener adopts it", () => {
  const { w, a } = windowWith("a");
  const b = S().newTab(w, { url: "https://b.com/", openerId: a, background: true });
  const c = S().newTab(w, { url: "https://c.com/", openerId: b, background: true });
  S().closeTab(b);
  assert.equal(S().tabs[c].openerId, a, "ordinary closing adopts the opener's opener");
  S().activate(c);
  assert.equal(canGoBack(c, live(c)), false, "back is not offered: the tab that opened this one is gone");
  goBack(c);
  assert.ok(S().tabs[c], "the tab stays");
  assert.equal(shown(w), c);
});

test("back on a link opened in a split pane closes it and shows the tab that opened it", () => {
  const { w, a } = windowWith("a");
  openLinkInSplit(a, "https://split.example/");
  const pane = Object.values(S().tabs).find((t) => t.url === "https://split.example/");
  assert.ok(pane, "the link opened in a pane beside the tab");
  assert.equal(pane.linkOpenerId, a, "a split link records the tab that opened it");
  assert.equal(live(pane.id).canGoBack, false);
  assert.equal(canGoBack(pane.id, live(pane.id)), true);
  goBack(pane.id);
  assert.equal(S().tabs[pane.id], undefined, "the pane's tab closed");
  assert.equal(shown(w), a);
});

test("back does nothing once the opener is gone", () => {
  const { w, a } = windowWith("a");
  const b = S().newTab(w, { url: "https://b.com/", openerId: a, background: false });
  S().closeTab(a);
  assert.ok(S().tabs[b]);
  assert.equal(canGoBack(b, live(b)), false);
  goBack(b);
  assert.ok(S().tabs[b], "the tab stays: there is no opener to go back to");
  assert.equal(shown(w), b);
});
