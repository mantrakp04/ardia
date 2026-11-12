import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { tabUnread, pageUnread } = await import("./unread.ts");
const { isUnreadShown, toggleSiteUnread, setSiteUnreadShown, showUnreadCounts } = await import("./unreadSites.ts");
const { tabMenuItems } = await import("../sidebar/tabMenu.ts");
const { settingsSnapshot } = await import("../telemetry/settingsSnapshot.ts");
const { DEFAULT_SETTINGS } = await import("../settings/settings.ts");

const S = () => useBrowser.getState();
const label = (id) => tabUnread(id)?.label ?? null;
const unreadItem = (w, id) => tabMenuItems(S(), w, S().tabs[id]).find((i) => i.id === "siteUnread" || i.id === "allUnread")?.title ?? null;

const setup = ({ on = true } = {}) => {
  S().hydrate({});
  if (on) S().updateSettings({ showUnreadCounts: true });
  const w = S().createWindow({ url: "https://mail.example/inbox" });
  const a = S().windows[w].tabIds[0];
  S().updateTab(a, { url: "https://mail.example/inbox", title: "(5) Inbox" });
  const b = S().newTab(w, { url: "https://mail.example/sent", background: true });
  S().updateTab(b, { title: "(2) Sent" });
  const c = S().newTab(w, { url: "https://www.chat.example/", background: true });
  S().updateTab(c, { title: "(7) Chat" });
  return { w, a, b, c };
};

test("counts are off by default, and turning them on shows every site's", () => {
  const { a, c } = setup({ on: false });
  assert.equal(DEFAULT_SETTINGS.showUnreadCounts, false);
  assert.deepEqual(DEFAULT_SETTINGS.unreadHiddenSites, []);
  assert.equal(label(a), null);
  assert.equal(label(c), null);
  assert.equal(pageUnread(a)?.label, "5", "the page's count is still read, ready for the switch");
  showUnreadCounts(true);
  assert.equal(label(a), "5");
  assert.equal(label(c), "7");
});

test("hiding a site's count hides it on every tab of that host and only there, and showing it brings it back", () => {
  const { a, b, c } = setup();
  toggleSiteUnread(a);
  assert.deepEqual(S().settings.unreadHiddenSites, ["mail.example"]);
  assert.equal(label(a), null);
  assert.equal(label(b), null);
  assert.equal(label(c), "7");
  assert.equal(pageUnread(a)?.label, "5", "the page still has its count; only the badge is hidden");
  toggleSiteUnread(b);
  assert.deepEqual(S().settings.unreadHiddenSites, []);
  assert.equal(label(a), "5");
});

test("the host key drops www, as Mute Site does, and a hide survives navigating away and back", () => {
  const { a, c } = setup();
  toggleSiteUnread(c);
  assert.deepEqual(S().settings.unreadHiddenSites, ["chat.example"]);
  assert.equal(isUnreadShown(S().settings, "https://chat.example/x"), false);
  S().updateTab(a, { url: "https://chat.example/room", title: "(3) Room" });
  assert.equal(label(a), null);
  S().updateTab(a, { url: "https://other.example/", title: "(3) Other" });
  assert.equal(label(a), "3");
});

test("setting a site twice doesn't duplicate it", () => {
  setup();
  setSiteUnreadShown("https://mail.example/", false);
  setSiteUnreadShown("https://mail.example/a", false);
  assert.deepEqual(S().settings.unreadHiddenSites, ["mail.example"]);
});

test("the global switch hides every badge and keeps each site's own choice", () => {
  const { a, c } = setup();
  toggleSiteUnread(a);
  S().updateSettings({ showUnreadCounts: false });
  assert.equal(label(a), null);
  assert.equal(label(c), null);
  S().updateSettings({ showUnreadCounts: true });
  assert.equal(label(a), null);
  assert.equal(label(c), "7");
});

test("the tab menu offers Hide Unread Count on a badged tab, Show Unread Count on a hidden site, nothing otherwise", () => {
  const { w, a } = setup();
  assert.equal(unreadItem(w, a), "Hide Unread Count");
  toggleSiteUnread(a);
  assert.equal(unreadItem(w, a), "Show Unread Count");
  toggleSiteUnread(a);
  S().updateTab(a, { title: "Inbox" });
  assert.equal(unreadItem(w, a), null);
  S().updateTab(a, { title: "(1) Inbox" });
  S().updateSettings({ showUnreadCounts: false });
  assert.equal(unreadItem(w, a), "Show Unread Counts");
  S().updateTab(a, { title: "Inbox" });
  assert.equal(unreadItem(w, a), null);
});

test("with counts off, a badged tab's menu offers Show Unread Counts, which turns them on everywhere", () => {
  const { w, a, c } = setup({ on: false });
  assert.equal(unreadItem(w, a), "Show Unread Counts");
  showUnreadCounts(true);
  assert.equal(S().settings.showUnreadCounts, true);
  assert.equal(unreadItem(w, a), "Hide Unread Count");
  assert.equal(label(c), "7");
});

test("a Top App's menu offers unread choices only while Top Apps show tab status, since its tile has no count otherwise", () => {
  const { w, a, b } = setup();
  S().pinTabs([a], true);
  S().pinTabs([b], true, true);
  assert.equal(S().settings.showTopAppBadges, false);
  assert.equal(unreadItem(w, a), null);
  assert.equal(unreadItem(w, b), "Hide Unread Count", "a pinned row keeps its count, so it keeps the choice");
  S().updateSettings({ showTopAppBadges: true });
  assert.equal(unreadItem(w, a), "Hide Unread Count");
  S().updateSettings({ showTopAppBadges: false, showUnreadCounts: false });
  assert.equal(unreadItem(w, a), null);
  assert.equal(unreadItem(w, b), "Show Unread Counts");
});

test("a private window's tab menu doesn't offer it, so no private host is saved", () => {
  S().hydrate({});
  const w = S().createWindow({ kind: "private", url: "https://mail.example/" });
  const a = S().windows[w].tabIds[0];
  S().updateTab(a, { url: "https://mail.example/", title: "(5) Inbox" });
  assert.equal(unreadItem(w, a), null);
  toggleSiteUnread(a);
  assert.deepEqual(S().settings.unreadHiddenSites, []);
});

test("telemetry counts hidden sites and reads the global switch, never a host", () => {
  const snap = settingsSnapshot({ ...DEFAULT_SETTINGS, showUnreadCounts: false, unreadHiddenSites: ["mail.example", "chat.example"] });
  assert.equal(snap.unread_hidden_sites, "2");
  assert.equal(snap.setting_showUnreadCounts, "false");
  assert.ok(!JSON.stringify(snap).includes("example"));
});
