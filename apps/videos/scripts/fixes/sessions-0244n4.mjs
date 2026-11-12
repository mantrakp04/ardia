import { DARK, TITLES, writeSession } from "./sessions-lib.mjs";

const TITLES_HERE = { ...TITLES, tunes: "Tunes", cinema: "Cinema" };
const T = (id, url, extra = {}) => ({ id, profileId: "default", url, title: url ? TITLES_HERE[new URL(url).hostname.split(".")[0]] : "", ...extra });

function build(file, tabs, active, settings) {
  writeSession(file, { tabs, active, settings: { ...DARK, ...settings } });
}

const TABS = [
  T("t1", "http://moodwall.example/"),
  T("t2", "http://docpad.example/"),
  T("t3", "http://lexicon.example/"),
  T("t4", "http://crumbs.example/"),
];

build("session-0244n4-side.json", [...TABS, T("n1", "")], "n1", {});

build("session-0244n4-little.json", TABS, "t1", { littleArdiaOpensNewTabLinks: true });

build("session-0244n4-move.json", TABS, "t1", { newTabPosition: "top" });
