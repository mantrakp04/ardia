import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { session } from "../../../../scripts/lib/instance.mjs";

const out = process.argv[2];
const TITLES = {
  moodwall: "moodwall — ideas for everything",
  docpad: "Trip plan — Docpad",
  lexicon: "meadow | Lexicon dictionary",
  crumbs: "Crumbs — Brown butter oat cookies",
  dailyledger: "The Daily Ledger",
  tunes: "Tunes",
  cinema: "Cinema",
  watch: "Watch",
};
const HOSTS = ["moodwall", "docpad", "lexicon", "crumbs", "dailyledger", "tunes", "cinema"];
const T = (id, url, extra = {}) => ({ id, profileId: "default", url, title: TITLES[new URL(url).hostname.split(".")[0]], ...extra });
const tile = (id, url, extra = {}) => T(id, url, { pinned: true, pinnedUrl: url, favicon: `${url}favicon.ico`, ...extra });
const PROFILES = [
  { id: "default", name: "Personal", color: "plum", icon: "🪐" },
  { id: "work", name: "Work", color: "blue", icon: "🔥", dataId: "default" },
  { id: "school", name: "School", color: "green", icon: "📚", dataId: "default" },
];

function build(file, { tabs, active, frame = [80, 60, 1360, 860], settings = {}, groups = [], profiles = PROFILES.slice(0, 1), tabLayout, extra = {} }) {
  const s = session({
    profiles,
    windows: [{ id: "w1", frame, profileId: "default", ...(tabLayout ? { tabLayout } : {}), activeTabIds: { default: active } }],
    tabs,
    groups,
  });
  Object.assign(s, extra);
  s.settings = { appearance: "dark", searchSuggestions: false, warnBeforeQuitting: false, sidebarWidth: 260, ...(tabLayout ? { tabLayout } : {}), ...settings };
  writeFileSync(join(out, file), JSON.stringify(s, null, 2));
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
