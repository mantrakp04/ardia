import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { session } from "../../../../scripts/lib/instance.mjs";

const out = process.argv[2];
const sites = join(dirname(fileURLToPath(import.meta.url)), "../capture/sites");
const media = [
  ["cinema.example/img/clip.mp4", ["-loop", "1", "-i", join(sites, "moodwall.example/img/2.jpg"), "-vf", "scale=2400:-2,crop=1920:1080:(in_w-1920)*t/12:(in_h-1080)/2,format=yuv420p", "-t", "12", "-r", "30", "-c:v", "libx264", "-crf", "22", "-movflags", "+faststart"]],
  ["watch.example/img/talk.mp4", ["-stream_loop", "16", "-i", join(sites, "cinema.example/img/clip.mp4"), "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=22050:duration=204", "-af", "volume=0.2", "-t", "204", "-c:v", "libx264", "-crf", "26", "-c:a", "aac", "-shortest", "-movflags", "+faststart"]],
];
for (const [file, args] of media) {
  const path = join(sites, file);
  if (existsSync(path)) continue;
  mkdirSync(dirname(path), { recursive: true });
  execFileSync("ffmpeg", ["-nostdin", "-v", "error", "-y", ...args, path]);
}

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

build("session-r44-newtab.json", { tabs: [...TABS, T("n1", "")], active: "n1" });

build("session-r44-basic.json", { tabs: [...TILES, ...TABS], active: "t1" });

build("session-r44-folder.json", {
  tabs: [tile("f1", "http://trails.example/", { pinnedAsRow: true }), tile("f2", "http://ferry.example/", { pinnedAsRow: true }), tile("f3", "http://hostel.example/", { pinnedAsRow: true }), ...TABS],
  active: "t1",
});

build("session-r44-profiles.json", {
  tabs: [...TILES, T("t1", "http://moodwall.example/"), T("t2", "http://docpad.example/"), T("w1", "http://library.example/", { profileId: "work" }), T("w2", "http://canopy.example/", { profileId: "work" })],
  active: "t1",
  profiles: PROFILES,
  windowExtra: { activeTabIds: { default: "t1", work: "w1" } },
});

build("session-r44-player.json", {
  tabs: [...TILES, T("t4", "http://watch.example/"), T("t5", "http://docpad.example/"), T("t6", "http://moodwall.example/")],
  active: "t4",
});

build("session-r44-glass.json", { tabs: [...TILES, ...TABS], active: "t1", settings: { interfaceStyle: "glass" } });

build("session-r44-cli.json", { tabs: [...TILES, ...TABS], active: "t1", settings: { cliControl: true } });


build("session-r44-small.json", { tabs: [...TILES, ...TABS], active: "t1", frame: [80, 60, 700, 500] });

const FOLDER = { id: "tf1", name: "Reading" };
build("session-r44-strip.json", {
  tabs: [
    tile("p1", "http://lexicon.example/"),
    tile("p2", "http://dailyledger.example/"),
    tile("k1", "http://library.example/", { tileFolder: FOLDER }),
    tile("k2", "http://canopy.example/", { tileFolder: FOLDER }),
    tile("k3", "http://docpad.example/", { tileFolder: FOLDER }),
    tile("g1t", "http://tunes.example/"),
    tile("g2t", "http://cinema.example/"),
    ...TABS,
  ],
  active: "t1",
  frame: [80, 60, 820, 600],
  settings: { tabLayout: "top" },
  windowExtra: { tabLayout: "top" },
});
