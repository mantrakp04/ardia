import { DARK, PERSONAL, TITLES, TRAVEL, WORK, writeSession } from "./sessions-lib.mjs";

const TITLES_HERE = { ...TITLES, tunes: "Tunes · Late Night Drive", watch: "Watch" };
const T = (id, profileId, url, extra = {}) => ({ id, profileId, url, title: TITLES_HERE[new URL(url).hostname.split(".")[0]], ...extra });
const tile = (id, url) => T(id, "default", url, { pinned: true, pinnedUrl: url });
const row = (id, url) => T(id, "default", url, { pinned: true, pinnedAsRow: true, pinnedUrl: url });
const profiles = [PERSONAL, WORK, TRAVEL];
const others = [T("w1", "work", "http://docpad.example/"), T("v1", "travel", "http://crumbs.example/")];
const base = [
  tile("p1", "http://moodwall.example/"),
  tile("p2", "http://crumbs.example/"),
  row("r1", "http://lexicon.example/"),
  row("r2", "http://dailyledger.example/"),
  row("r3", "http://docpad.example/"),
  T("t1", "default", "http://moodwall.example/"),
  T("t2", "default", "http://docpad.example/"),
  T("t3", "default", "http://crumbs.example/"),
  ...others,
];

function build(file, { tabs = base, active = "t1", settings = {} } = {}) {
  writeSession(file, { profiles, tabs, activeTabIds: { default: active, work: "w1", travel: "v1" }, settings: { ...DARK, appearance: "light", ...settings } })
}

build("session-0243-base.json");
build("session-0243-flash.json", {
  tabs: [
    row("t1", "http://lexicon.example/"),
    row("t2", "http://dailyledger.example/"),
    T("t3", "default", "http://moodwall.example/"),
    T("t4", "default", "http://docpad.example/"),
    T("t5", "default", "http://crumbs.example/"),
    T("t6", "default", "http://lexicon.example/"),
    ...others,
  ],
  active: "t3",
});
build("session-0243-mute.json", {
  tabs: [...base.slice(0, 5), T("m1", "default", "http://tunes.example/?side=a"), T("m2", "default", "http://tunes.example/?side=b"), T("t2", "default", "http://docpad.example/"), ...others],
  active: "t2",
});
build("session-0243-player.json", {
  tabs: [...base.slice(0, 5), T("t4", "default", "http://watch.example/"), T("t5", "default", "http://docpad.example/"), T("t6", "default", "http://moodwall.example/"), ...others],
  active: "t4",
});
build("session-0243-settings.json", { settings: { appearance: "dark" } });
