import { join } from "node:path";
import { DARK, ensureMedia, FRAME, PERSONAL, sites, TITLES, writeSession } from "./sessions-lib.mjs";

const media = [
  ["cinema.example/img/clip.mp4", ["-loop", "1", "-i", join(sites, "moodwall.example/img/2.jpg"), "-vf", "scale=2400:-2,crop=1920:1080:(in_w-1920)*t/12:(in_h-1080)/2,format=yuv420p", "-t", "12", "-r", "30", "-c:v", "libx264", "-crf", "22", "-movflags", "+faststart"]],
  ["watch.example/img/talk.mp4", ["-stream_loop", "16", "-i", join(sites, "cinema.example/img/clip.mp4"), "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=22050:duration=204", "-af", "volume=0.2", "-t", "204", "-c:v", "libx264", "-crf", "26", "-c:a", "aac", "-shortest", "-movflags", "+faststart"]],
];
ensureMedia(media);

const TITLES_HERE = { ...TITLES, tunes: "Tunes", cinema: "Cinema", watch: "Watch · How the hills got their colour", trails: "Trails", eats: "Eats", ferry: "Ferry times", hostel: "Hostel", canopy: "Canopy", library: "Library" };
const titleOf = (url) => (url ? TITLES_HERE[new URL(url).hostname.split(".")[0]] ?? new URL(url).hostname : "");
const T = (id, url, extra = {}) => ({ id, profileId: "default", url, title: titleOf(url), ...extra });
const tile = (id, url, extra = {}) => T(id, url, { pinned: true, pinnedUrl: url, ...extra });
const PROFILES = [PERSONAL, { id: "work", name: "Work", color: "blue", icon: "🔥", dataId: "default" }];

function build(file, { tabs, active, frame, settings = {}, groups = [], profiles = [PERSONAL], extra = {}, windowExtra = {} }) {
  writeSession(file, { profiles, tabs, groups, active, frame, windowExtra, extra, settings: { ...DARK, ...settings } });
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
