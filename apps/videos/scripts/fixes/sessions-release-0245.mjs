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
  watch: "Watch · How the hills got their colour",
  trails: "Trails",
  eats: "Eats",
  ferry: "Ferry times",
  hostel: "Hostel",
  canopy: "Canopy",
  library: "Library",
};
const titleOf = (url) => (url ? TITLES[new URL(url).hostname.split(".")[0]] ?? new URL(url).hostname : "");
const T = (id, url, extra = {}) => ({ id, profileId: "default", url, title: titleOf(url), ...extra });
const tile = (id, url, extra = {}) => T(id, url, { pinned: true, pinnedUrl: url, ...extra });
const PERSONAL = { id: "default", name: "Personal", color: "plum", icon: "🪐" };
const PROFILES = [PERSONAL, { id: "work", name: "Work", color: "blue", icon: "🔥", dataId: "default" }];
const BASE = { appearance: "dark", searchSuggestions: false, warnBeforeQuitting: false, sidebarWidth: 260 };
const FRAME = [80, 60, 1360, 860];

function build(file, { tabs, active, frame = FRAME, settings = {}, groups = [], profiles = [PERSONAL], extra = {}, windowExtra = {} }) {
  const s = session({
    profiles,
    windows: [{ id: "w1", frame, profileId: "default", activeTabIds: { default: active }, ...windowExtra }],
    tabs,
    groups,
  });
  Object.assign(s, extra);
  s.settings = { ...BASE, ...settings };
  writeFileSync(join(out, file), JSON.stringify(s, null, 2));
}

const TABS = [T("t1", "http://moodwall.example/"), T("t2", "http://docpad.example/"), T("t3", "http://lexicon.example/"), T("t4", "http://crumbs.example/")];
const TILES = [tile("p1", "http://lexicon.example/"), tile("p2", "http://dailyledger.example/"), tile("p3", "http://crumbs.example/")];
const SMALL = [80, 60, 1100, 720];

build("session-r45-basic.json", { tabs: [...TILES, ...TABS], active: "t1", frame: SMALL });

build("session-r45-top.json", {
  tabs: [...TILES, ...TABS],
  active: "t1",
  frame: SMALL,
  settings: { tabLayout: "top" },
  windowExtra: { tabLayout: "top" },
});

build("session-r45-switch.json", {
  tabs: [
    tile("p1", "http://lexicon.example/"),
    tile("p2", "http://dailyledger.example/"),
    tile("p3", "http://crumbs.example/"),
    tile("p4", "http://trails.example/", { pinnedAsRow: true }),
    tile("p5", "http://ferry.example/", { pinnedAsRow: true }),
    tile("p6", "http://hostel.example/", { pinnedAsRow: true }),
    T("t1", "http://moodwall.example/"),
    T("t2", "http://docpad.example/"),
  ],
  active: "t1",
  frame: SMALL,
});

build("session-r45-bookmarks.json", { tabs: [T("t1", "http://moodwall.example/"), T("b1", "ardia://bookmarks", { title: "Bookmarks" })], active: "b1", frame: SMALL });

build("session-r45-cli.json", {
  tabs: [...TILES, T("t1", "http://moodwall.example/"), T("t2", "http://docpad.example/")],
  active: "t1",
  frame: SMALL,
  settings: { cliControl: true },
});

build("session-r45-newtab.json", { tabs: [...TILES, T("t1", "http://moodwall.example/"), T("t2", "http://docpad.example/"), T("n1", "")], active: "n1", frame: SMALL });
