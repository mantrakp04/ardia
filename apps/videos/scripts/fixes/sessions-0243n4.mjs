import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { session } from "../../../../scripts/lib/instance.mjs";

const out = process.argv[2];
const sites = join(dirname(fileURLToPath(import.meta.url)), "../capture/sites");
const tone = join(sites, "tunes.example/img/tone.wav");
if (!existsSync(tone)) {
  mkdirSync(dirname(tone), { recursive: true });
  execFileSync("ffmpeg", ["-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=22050:duration=90", "-af", "volume=0.3", tone]);
}
const TITLES = {
  lexicon: "meadow | Lexicon dictionary",
  dailyledger: "The Daily Ledger",
  moodwall: "moodwall — ideas for everything",
  docpad: "Trip plan — Docpad",
  crumbs: "Crumbs — Brown butter oat cookies",
  tunes: "Tunes · Late Night Drive",
};
const T = (id, profileId, url, extra = {}) => ({ id, profileId, url, title: TITLES[new URL(url).hostname.split(".")[0]], ...extra });
const tile = (id, url) => T(id, "default", url, { pinned: true, pinnedUrl: url });
const row = (id, url) => T(id, "default", url, { pinned: true, pinnedAsRow: true, pinnedUrl: url });
const profiles = [
  { id: "default", name: "Personal", color: "plum", icon: "🪐" },
  { id: "work", name: "Work", color: "blue", icon: "🔥" },
  { id: "travel", name: "Travel", color: "orange", icon: "✈️" },
];
const base = [
  tile("p1", "http://moodwall.example/"),
  tile("p2", "http://crumbs.example/"),
  row("r1", "http://lexicon.example/"),
  row("r2", "http://dailyledger.example/"),
  row("r3", "http://docpad.example/"),
  T("t1", "default", "http://moodwall.example/"),
  T("t2", "default", "http://docpad.example/"),
  T("t3", "default", "http://crumbs.example/"),
  T("w1", "work", "http://docpad.example/"),
  T("v1", "travel", "http://crumbs.example/"),
];

function build(file, { tabs = base, active = "t1", settings = {} } = {}) {
  const s = session({
    profiles,
    windows: [{ id: "w1", frame: [80, 60, 1360, 860], profileId: "default", activeTabIds: { default: active, work: "w1", travel: "v1" } }],
    tabs,
  });
  s.settings = {
    appearance: "light",
    searchSuggestions: false,
    warnBeforeQuitting: false,
    profileSwitcherIcons: true,
    peekLinksToOtherSites: true,
    sidebarWidth: 260,
    ...settings,
  };
  writeFileSync(join(out, file), JSON.stringify(s, null, 2));
}

build("session.json");
build("session-peek.json", { active: "r1" });
build("session-bar.json", { settings: { bookmarksBar: "always" } });
build("session-mute.json", {
  tabs: [
    ...base.slice(0, 5),
    T("m1", "default", "http://tunes.example/?side=a"),
    T("m2", "default", "http://tunes.example/?side=b"),
    T("t2", "default", "http://docpad.example/"),
    T("w1", "work", "http://docpad.example/"),
    T("v1", "travel", "http://crumbs.example/"),
  ],
  active: "t2",
});
