import { DARK, PERSONAL, TITLES, writeSession } from "./sessions-lib.mjs";

const TITLES_HERE = { ...TITLES, tunes: "Tunes", cinema: "Cinema", watch: "Watch" };
const HOSTS = ["moodwall", "docpad", "lexicon", "crumbs", "dailyledger", "tunes", "cinema"];
const T = (id, url, extra = {}) => ({ id, profileId: "default", url, title: TITLES_HERE[new URL(url).hostname.split(".")[0]], ...extra });
const tile = (id, url, extra = {}) => T(id, url, { pinned: true, pinnedUrl: url, favicon: `${url}favicon.ico`, ...extra });
const PROFILES = [
  PERSONAL,
  { id: "work", name: "Work", color: "blue", icon: "🔥", dataId: "default" },
  { id: "school", name: "School", color: "green", icon: "📚", dataId: "default" },
];

function build(file, { tabs, active, frame, settings = {}, groups = [], profiles = PROFILES.slice(0, 1), tabLayout, extra = {} }) {
  writeSession(file, { profiles, tabs, groups, active, frame, windowExtra: tabLayout ? { tabLayout } : {}, extra, settings: { ...DARK, ...(tabLayout ? { tabLayout } : {}), ...settings } });
}

const TILES = [tile("p1", "http://lexicon.example/"), tile("p2", "http://dailyledger.example/"), tile("p3", "http://crumbs.example/")];
const FOLDER = [tile("f1", "http://tunes.example/"), tile("f2", "http://cinema.example/")];
const PINNED_GROUP = { id: "g1", windowId: "w1", profileId: "default", name: "Weekend", icon: "🌿", color: "green", collapsed: true, pinned: true, tabIds: ["f1", "f2"], createdAt: 1 };
const many = Array.from({ length: 16 }, (_, i) => T(`t${i + 1}`, `http://${HOSTS[i % HOSTS.length]}.example/`));

build("session-0244n7-strip.json", { tabs: [...TILES, ...FOLDER, ...many], active: "t1", groups: [PINNED_GROUP], tabLayout: "top", frame: [80, 60, 820, 600] });

build("session-0244n7-split.json", { tabs: [...TILES, ...many.slice(0, 5)], active: "t1", tabLayout: "top" });

build("session-0244n7-pip.json", {
  tabs: [T("v1", "http://watch.example/"), T("t1", "http://docpad.example/"), T("t2", "http://moodwall.example/")],
  active: "v1",
  frame: [0, 33, 1512, 949],
});

build("session-0244n7-profiles.json", {
  tabs: [...TILES, T("t1", "http://moodwall.example/"), T("w1", "http://docpad.example/", { profileId: "work" }), T("s1", "http://lexicon.example/", { profileId: "school" })],
  active: "t1",
  frame: [80, 60, 760, 540],
  profiles: PROFILES,
  settings: { shareTopApps: true },
});
