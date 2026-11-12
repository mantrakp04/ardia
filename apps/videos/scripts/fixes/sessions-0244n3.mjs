import { DARK, PERSONAL, TITLES, writeSession } from "./sessions-lib.mjs";

const T = (id, url, extra = {}) => ({ id, profileId: "default", url, title: url ? TITLES[new URL(url).hostname.split(".")[0]] : "", ...extra });

function build(file, tabs, active, settings, frame) {
  writeSession(file, { profiles: [PERSONAL, { id: "work", name: "Work", color: "blue", icon: null }], tabs, active, frame, settings: { ...DARK, ...settings } });
}

const TABS = [
  T("t1", "http://moodwall.example/"),
  T("t2", "http://docpad.example/"),
  T("t3", "http://lexicon.example/"),
];

build("session-0244n3-field.json", [...TABS, T("n1", "")], "n1", { addressBar: "sidebar", commandBarPlacement: "centred" });

build("session-0244n3-profiles.json", TABS, "t1", {}, [80, 60, 760, 540]);
