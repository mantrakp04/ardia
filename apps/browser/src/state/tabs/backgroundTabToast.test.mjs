import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;

const { useBrowser } = await import("../browser/store.ts");
const { activeTabId } = await import("../browser/model.ts");
const { useToasts } = await import("../splits/actions.ts");
const { setPeekShown } = await import("../windows/dockMotion.ts");
const { openFromPage } = await import("./openFromPage.ts");

const S = () => useBrowser.getState();
const toast = (w) => useToasts.getState().toasts[w] ?? null;
const setup = ({ sidebar = false } = {}) => {
  useToasts.setState({ toasts: {} });
  S().hydrate({});
  const w = S().createWindow({ url: "https://a.com/" });
  const page = S().windows[w].tabIds[0];
  if (!sidebar) S().toggleSidebar(w);
  const open = (url, disposition = "background") => {
    openFromPage({ url, disposition }, { windowId: w, profileId: S().windows[w].profileId, tabId: page });
    return S().windows[w].tabIds.at(-1);
  };
  return { w, page, open };
};

test("a link opened behind while the tabs are hidden says so, and its toast switches to it", () => {
  const { w, page, open } = setup();
  const b = open("https://b.com/");
  const t = toast(w);
  assert.equal(t?.title, "New Tab Created");
  assert.equal(t?.tabId, b);
  assert.equal(activeTabId(S(), w), page);
  t.onPress();
  assert.equal(activeTabId(S(), w), b);
  assert.equal(toast(w), null);
});

test("no toast while the tabs are in sight: sidebar shown, or peeking", () => {
  const shown = setup({ sidebar: true });
  shown.open("https://b.com/");
  assert.equal(toast(shown.w), null);
  const peeking = setup();
  setPeekShown(peeking.w, true, 250);
  peeking.open("https://b.com/");
  assert.equal(toast(peeking.w), null);
  setPeekShown(peeking.w, false);
});

test("a foreground open shows no toast", () => {
  const { w, open } = setup();
  open("https://b.com/", "foreground");
  assert.equal(toast(w), null);
});

test("links opened in a row count up in one toast that switches to the latest", () => {
  const { w, open } = setup();
  open("https://b.com/");
  const first = toast(w).id;
  const c = open("https://c.com/");
  assert.equal(toast(w).title, "2 New Tabs Created");
  assert.equal(toast(w).id, first);
  assert.equal(toast(w).tabId, c);
  toast(w).action.run();
  assert.equal(activeTabId(S(), w), c);
});

test("the toast goes when its tab is closed, switched to another way, or the tabs come back", () => {
  const closed = setup();
  const b = closed.open("https://b.com/");
  S().closeTab(b);
  assert.equal(toast(closed.w), null);

  const switched = setup();
  const c = switched.open("https://c.com/");
  S().activate(c);
  assert.equal(toast(switched.w), null);

  const revealed = setup();
  revealed.open("https://d.com/");
  S().toggleSidebar(revealed.w);
  assert.equal(toast(revealed.w), null);

  const peeked = setup();
  peeked.open("https://e.com/");
  setPeekShown(peeked.w, true, 250);
  assert.equal(toast(peeked.w), null);
  setPeekShown(peeked.w, false);
});

test("a tab that lands in another profile names it, even with the sidebar shown", () => {
  const { w, page } = setup({ sidebar: true });
  const work = S().createProfile({ name: "Work" });
  openFromPage({ url: "https://b.com/", disposition: "foreground" }, { windowId: w, profileId: work, tabId: page });
  const b = Object.values(S().tabs).find((t) => t.profileId === work && t.url === "https://b.com/")?.id;
  assert.ok(b);
  assert.equal(toast(w)?.title, "New Tab Created in Work");
  toast(w).onPress();
  assert.equal(S().windows[w].profileId, work);
  assert.equal(activeTabId(S(), w), b);
  assert.equal(toast(w), null);
});

test("a toast in another window keeps the first window's toast watched", () => {
  const first = setup();
  const b = first.open("https://b.com/");
  const w2 = S().createWindow({ url: "https://x.com/" });
  S().toggleSidebar(w2);
  const page2 = S().windows[w2].tabIds[0];
  openFromPage({ url: "https://y.com/", disposition: "background" }, { windowId: w2, profileId: S().windows[w2].profileId, tabId: page2 });
  assert.equal(toast(w2)?.title, "New Tab Created");
  assert.equal(toast(first.w)?.tabId, b);
  S().closeTab(b);
  assert.equal(toast(first.w), null);
  assert.ok(toast(w2));
});
