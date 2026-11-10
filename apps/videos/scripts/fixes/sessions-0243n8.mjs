import { DARK, PERSONAL, TITLES, WORK, writeSession } from "./sessions-lib.mjs";

const TITLES_HERE = { ...TITLES, tunes: "Tunes · Late Night Drive", watch: "Watch" };
const T = (id, url, extra = {}) => ({ id, profileId: "default", url, title: TITLES_HERE[new URL(url).hostname.split(".")[0]], ...extra });
const tile = (id, url, extra = {}) => T(id, url, { pinned: true, pinnedUrl: url, favicon: `${url}favicon.ico`, ...extra });
const profiles = [PERSONAL, WORK];
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
  writeSession(file, { profiles, tabs, windows, activeTabIds: { default: active, work: "w1" }, settings: { ...DARK, ...settings } });
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
