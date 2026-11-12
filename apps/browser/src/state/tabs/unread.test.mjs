import assert from "node:assert/strict";
import { mock, test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const model = await import("../browser/model.ts");
const { startPinHandoff } = await import("../pins/pinHandoff.ts");
const { webviews, webviewRef } = await import("../../platform/webviews.ts");
const { forgetUnreadIfGone, unreadSignalTabs, noteAppBadge, noteUnreadFavicon, noteUnreadLoading, noteUnreadPageEnded, tabUnread } = await import("./unread.ts");

const S = () => useBrowser.getState();
mock.timers.enable({ apis: ["setTimeout"] });
startPinHandoff();
const shown = (id) => {
  const u = tabUnread(id);
  return u === null ? null : u.kind === "dot" ? "dot" : u.label;
};

const setup = (url = "https://mail.example/inbox") => {
  S().hydrate({});
  S().updateSettings({ showUnreadCounts: true });
  const w = S().createWindow({ url });
  const a = S().windows[w].tabIds[0];
  S().updateTab(a, { url, title: "Inbox - Mail" });
  return { w, a };
};

test("the title's count shows while the page lives, and clears when it drops to zero", () => {
  const { a } = setup();
  assert.equal(shown(a), null);
  S().updateTab(a, { title: "Inbox (3) - me@mail.example - Mail" });
  assert.equal(shown(a), "3");
  S().updateTab(a, { title: "Inbox - me@mail.example - Mail" });
  assert.equal(shown(a), null);
});

test("a sleeping tab shows no stale count from its saved title", () => {
  const { a } = setup();
  S().updateTab(a, { title: "(4) Home / X", page: { kind: "asleep" } });
  assert.equal(shown(a), null);
});

test("the Badging API wins over the title, for the origin that set it, until cleared", () => {
  const { a } = setup();
  S().updateTab(a, { title: "(2) Mail" });
  noteAppBadge(a, { origin: "https://mail.example", count: 9, flag: false });
  assert.equal(shown(a), "9");
  noteAppBadge(a, { origin: "https://mail.example", count: null, flag: true });
  assert.equal(shown(a), "dot");
  noteAppBadge(a, { origin: "https://mail.example", count: null, flag: false });
  assert.equal(shown(a), "2");
  noteAppBadge(a, { origin: "https://mail.example", count: 5, flag: false });
  S().updateTab(a, { url: "https://other.example/", title: "Other" });
  assert.equal(shown(a), null);
});

test("a favicon swapped for a badge-named one shows a dot until the site's own icon comes back", () => {
  const { a } = setup();
  noteUnreadFavicon(a, "https://mail.example/inbox", "https://mail.example/favicon.ico");
  assert.equal(shown(a), null);
  noteUnreadFavicon(a, "https://mail.example/inbox", "https://mail.example/favicon-unread.ico");
  assert.equal(shown(a), "dot");
  S().updateTab(a, { title: "Inbox (6) - Mail" });
  assert.equal(shown(a), "6");
  S().updateTab(a, { title: "Inbox - Mail" });
  noteUnreadFavicon(a, "https://mail.example/inbox", "https://mail.example/favicon.ico");
  assert.equal(shown(a), null);
});

test("an icon that was already badged or drawn at load never becomes the baseline", () => {
  const { a } = setup();
  noteUnreadFavicon(a, "https://mail.example/inbox", "data:image/png;base64,AAAA");
  noteUnreadFavicon(a, "https://mail.example/inbox", "https://mail.example/favicon-unread.ico");
  assert.equal(shown(a), null);
  noteUnreadFavicon(a, "https://mail.example/inbox", "https://mail.example/favicon.ico");
  noteUnreadFavicon(a, "https://mail.example/inbox", "data:image/png;base64,BBBB");
  assert.equal(shown(a), null);
  noteUnreadFavicon(a, "https://mail.example/inbox", "https://mail.example/favicon-unread.ico");
  assert.equal(shown(a), "dot");
});

test("a discarded or crashed page shows nothing until its replacement has finished loading", () => {
  const { a } = setup();
  S().updateTab(a, { title: "Inbox (3) - Mail" });
  noteAppBadge(a, { origin: "https://mail.example", count: 9, flag: false });
  assert.equal(shown(a), "9");
  noteUnreadPageEnded(a);
  assert.equal(shown(a), null);
  noteUnreadLoading(a, false);
  assert.equal(shown(a), null, "a late event from the old page doesn't bring it back");
  noteUnreadLoading(a, true);
  assert.equal(shown(a), null, "the old title still reported while loading doesn't count");
  noteAppBadge(a, { origin: "https://mail.example", count: 2, flag: false });
  assert.equal(shown(a), "2", "a badge the new document sets shows at once");
  noteAppBadge(a, { origin: "https://mail.example", count: null, flag: false });
  assert.equal(shown(a), null);
  S().updateTab(a, { title: "Inbox (4) - Mail" });
  noteUnreadLoading(a, false);
  assert.equal(shown(a), "4");
  noteUnreadPageEnded(a);
  assert.equal(shown(a), null);
});

test("a tab's signals stay while its page lives and go when the tab closes or sleeps", () => {
  const { w, a } = setup();
  const b = S().newTab(w, { url: "https://chat.example/", background: true });
  const c = S().newTab(w, { url: "https://news.example/", background: true });
  noteAppBadge(b, { origin: "https://chat.example", count: 1, flag: false });
  noteAppBadge(c, { origin: "https://news.example", count: 1, flag: false });
  forgetUnreadIfGone(b);
  assert.equal(shown(b), "1", "a page moving to another window keeps its badge");
  S().closeTab(b);
  forgetUnreadIfGone(b);
  S().updateTab(c, { page: { kind: "asleep" } });
  forgetUnreadIfGone(c);
  assert.deepEqual(unreadSignalTabs().filter((id) => id === b || id === c), []);
  assert.equal(shown(a), null);
});

test("each site in a tab keeps its own Badging API badge, so Back to an earlier one shows it again", () => {
  const { a } = setup();
  noteAppBadge(a, { origin: "https://mail.example", count: 8, flag: false });
  S().updateTab(a, { url: "https://chat.example/", title: "Chat" });
  noteAppBadge(a, { origin: "https://chat.example", count: 2, flag: false });
  assert.equal(shown(a), "2");
  S().updateTab(a, { url: "https://mail.example/inbox", title: "Inbox - Mail" });
  assert.equal(shown(a), "8");
});

test("a pinned copy whose page moved to another window shows that page's badge", async () => {
  S().hydrate({});
  S().updateSettings({ showUnreadCounts: true });
  const a = S().createWindow({ url: "https://mail.example/" });
  const [mail] = S().windows[a].tabIds;
  S().newTab(a, { url: "https://a.example/" });
  S().pinTabs([mail], true);
  S().activate(mail);
  const b = S().createWindow({ url: "https://b.example/" });
  webviewRef(mail)({ capturePicture: () => Promise.resolve({ data: "AA", frame: [0, 0, 1, 1] }) });
  S().activate(model.viewTabIds(S(), b).find((id) => !!S().tabs[id].pin));
  for (let t = 0; S().tabs[mail].windowId !== b && t < 2000; t += 10) {
    mock.timers.tick(10);
    await new Promise((r) => setImmediate(r));
  }
  const copy = S().windows[a].activeTabIds.default;
  assert.equal(S().tabs[copy].page.holderId, mail);
  S().updateTab(mail, { title: "Inbox (5) - Mail" });
  assert.equal(shown(copy), "5");
  noteAppBadge(mail, { origin: "https://mail.example", count: 12, flag: false });
  assert.equal(shown(copy), "12");
  noteAppBadge(mail, { origin: "https://mail.example", count: null, flag: false });
  S().updateTab(mail, { title: "Inbox - Mail" });
  assert.equal(shown(copy), null);
  webviews.delete(mail);
});

