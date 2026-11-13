import { DARK, PERSONAL, TITLES, WORK, hostOf, writeSession } from "./sessions-lib.mjs";

const TITLES_HERE = { ...TITLES, mail: "Inbox — Mailbox", chat: "General — Pinecone", news: "Morning Digest", forum: "Threadly · The best sourdough starter?" };
const T = (id, url, extra = {}) => ({ id, profileId: "default", url, title: TITLES_HERE[hostOf(url)] ?? hostOf(url), ...extra });
const tile = (id, url, extra = {}) => T(id, url, { pinned: true, pinnedUrl: url, ...extra });
const SMALL = [80, 60, 1100, 720];
const flat = (color, mode) => ({ stops: [{ x: 0.2, y: 0.2, color }, { x: 0.8, y: 0.8, color }], intensity: 1, mode, grain: 0, texture: "grain", translucency: 1 });

const TABS = [T("t1", "http://docpad.example/"), T("t2", "http://lexicon.example/"), T("t3", "http://crumbs.example/"), T("t4", "http://dailyledger.example/"), T("t5", "http://forum.example/")];

function build(file, { tabs, active, frame = SMALL, settings = {}, groups, profiles = [PERSONAL], activeTabIds }) {
  writeSession(file, { profiles, tabs, groups, active, activeTabIds, frame, settings: { ...DARK, ...settings } });
}

build("session-r46-news.json", { tabs: [T("n1", "http://news.example/"), ...TABS], active: "n1" });

build("session-r46-apps.json", {
  tabs: [tile("p1", "http://mail.example/"), tile("p2", "http://chat.example/"), tile("p3", "http://crumbs.example/"), ...TABS],
  active: "t1",
  settings: { showUnreadCounts: true },
});

const CALM = TABS.map((t) => (t.id === "t2" ? T("t2", "http://chat.example/") : t));

build("session-r46-light.json", {
  tabs: [tile("p1", "http://mail.example/"), tile("p2", "http://lexicon.example/"), ...CALM],
  active: "t2",
  profiles: [{ id: "default", name: "Mist", color: "neutral", icon: "🌫️", theme: flat({ r: 0.88, g: 0.88, b: 0.88, a: 1 }, "dark") }],
});

build("session-r46-group.json", {
  tabs: CALM,
  active: "t2",
  groups: [{ id: "g1", windowId: "w1", profileId: "default", name: "Weekend", icon: "🌿", color: "green", collapsed: false, pinned: false, tabIds: ["t2", "t3"], createdAt: 1 }],
});

const MANY = Array.from({ length: 200 }, (_, i) => {
  const url = ["http://docpad.example/", "http://lexicon.example/", "http://crumbs.example/", "http://dailyledger.example/", "http://forum.example/", "http://moodwall.example/"][i % 6];
  return T(`m${i + 1}`, `${url}?n=${i + 1}`, { title: `${TITLES_HERE[hostOf(url)] ?? hostOf(url)} · ${i + 1}` });
});
build("session-r46-many.json", { tabs: MANY, active: "m199", frame: [80, 60, 1100, 720] });

build("session-r46-profiles.json", {
  tabs: [...TABS.slice(0, 3), T("w1t", "http://dailyledger.example/", { profileId: "work" }), T("w2t", "http://forum.example/", { profileId: "work" }), T("w3t", "http://moodwall.example/", { profileId: "work" })],
  profiles: [PERSONAL, { ...WORK, dataId: "default" }],
  activeTabIds: { default: "t1", work: "w1t" },
});

build("session-r46-cmdbar.json", { tabs: TABS, active: "t1" });

build("session-r46-blank.json", {
  tabs: [T("k1", "http://links.example/", { title: "Ferry links" }), T("t1", "http://docpad.example/"), T("t4", "http://dailyledger.example/")],
  active: "k1",
  settings: { newTabLinksOpenIn: "tab", showUnreadCounts: false },
});
