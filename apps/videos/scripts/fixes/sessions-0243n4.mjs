import { DARK, ensureMedia, PERSONAL, TITLES, TRAVEL, WORK, writeSession } from "./sessions-lib.mjs";

ensureMedia([["tunes.example/img/tone.wav", ["-f", "lavfi", "-i", "sine=frequency=220:sample_rate=22050:duration=90", "-af", "volume=0.3"]]]);
const TITLES_HERE = { ...TITLES, tunes: "Tunes · Late Night Drive" };
const T = (id, profileId, url, extra = {}) => ({ id, profileId, url, title: TITLES_HERE[new URL(url).hostname.split(".")[0]], ...extra });
const tile = (id, url) => T(id, "default", url, { pinned: true, pinnedUrl: url });
const row = (id, url) => T(id, "default", url, { pinned: true, pinnedAsRow: true, pinnedUrl: url });
const profiles = [PERSONAL, WORK, TRAVEL];
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
  writeSession(file, {
    profiles,
    tabs,
    activeTabIds: { default: active, work: "w1", travel: "v1" },
    settings: { ...DARK, appearance: "light", profileSwitcherIcons: true, peekLinksToOtherSites: true, ...settings },
  });
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
