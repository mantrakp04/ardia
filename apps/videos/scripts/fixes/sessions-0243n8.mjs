import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { session } from "../../../../scripts/lib/instance.mjs";

const out = process.argv[2];
const TITLES = {
  lexicon: "meadow | Lexicon dictionary",
  dailyledger: "The Daily Ledger",
  moodwall: "moodwall — ideas for everything",
  docpad: "Trip plan — Docpad",
  crumbs: "Crumbs — Brown butter oat cookies",
  tunes: "Tunes · Late Night Drive",
  watch: "Watch",
};
const T = (id, url, extra = {}) => ({ id, profileId: "default", url, title: TITLES[new URL(url).hostname.split(".")[0]], ...extra });
const tile = (id, url, extra = {}) => T(id, url, { pinned: true, pinnedUrl: url, favicon: `${url}favicon.ico`, ...extra });
const profiles = [
  { id: "default", name: "Personal", color: "plum", icon: "🪐" },
  { id: "work", name: "Work", color: "blue", icon: "🔥" },
];
const base = [
  tile("p1", "http://lexicon.example/"),
  tile("p2", "http://dailyledger.example/"),
  tile("p3", "http://crumbs.example/"),
  T("t1", "http://moodwall.example/"),
  T("t2", "http://docpad.example/"),
  T("t3", "http://lexicon.example/"),
  T("w1", "http://docpad.example/", { profileId: "work" }),
  T("w2", "http://dailyledger.example/", { profileId: "work" }),
];

function build(file, { tabs = base, active = "t1", windows, settings = {} } = {}) {
  const s = session({
    profiles,
    windows: windows ?? [{ id: "w1", frame: [80, 60, 1360, 860], profileId: "default", activeTabIds: { default: active, work: "w1" } }],
    tabs,
  });
  s.settings = { appearance: "dark", searchSuggestions: false, warnBeforeQuitting: false, sidebarWidth: 260, ...settings };
  writeFileSync(join(out, file), JSON.stringify(s, null, 2));
}

build("session-0243n8-arc.json", { settings: { addressBar: "sidebar" } });
build("session-0243n8.json");
build("session-0243n8-top.json", {
  windows: [{ id: "w1", frame: [80, 60, 1360, 860], profileId: "default", tabLayout: "top", activeTabIds: { default: "t1", work: "w1" } }],
  settings: { tabLayout: "top" },
});
build("session-0243n8-work.json", {
  windows: [{ id: "w1", frame: [80, 60, 1360, 860], profileId: "work", activeTabIds: { default: "t1", work: "w1" } }],
});
build("session-0243n8-player.json", {
  tabs: [...base.slice(0, 3), T("t4", "http://watch.example/"), T("t1", "http://docpad.example/"), T("t2", "http://moodwall.example/")],
  active: "t4",
});
