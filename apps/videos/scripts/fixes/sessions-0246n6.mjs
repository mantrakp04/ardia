import { DARK, TITLES, writeSession } from "./sessions-lib.mjs";

const TITLES_HERE = { ...TITLES, mail: "Inbox — Mailbox", chat: "General — Pinecone", forum: "Threadly · The best sourdough starter?" };
const T = (id, url, extra = {}) => ({ id, profileId: "default", url, title: TITLES_HERE[new URL(url).hostname.split(".")[0]], ...extra });

const TABS = [
  T("t1", "http://moodwall.example/"),
  T("t2", "http://docpad.example/"),
  T("t3", "http://lexicon.example/"),
  T("t4", "http://crumbs.example/"),
  T("t5", "http://dailyledger.example/"),
  T("t6", "http://forum.example/"),
];

writeSession("session-0246n6-tabs.json", { tabs: TABS, active: "t2" });

writeSession("session-0246n6-right.json", { tabs: TABS, active: "t2", settings: { ...DARK, sidebarSide: "right", addressBar: "sidebar" } });

writeSession("session-0246n6-unread.json", {
  tabs: [T("u1", "http://mail.example/"), T("u2", "http://chat.example/"), ...TABS.slice(0, 3)],
  active: "u1",
  settings: { ...DARK, showUnreadCounts: true },
});

writeSession("session-0246n6-centred.json", { tabs: TABS, active: "t2", settings: { ...DARK, commandBarPlacement: "centred" } });
