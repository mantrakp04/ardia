import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { session } from "../../../../scripts/lib/instance.mjs";

const out = process.argv[2];
const TITLES = {
  moodwall: "moodwall — ideas for everything",
  docpad: "Trip plan — Docpad",
  lexicon: "meadow | Lexicon dictionary",
  crumbs: "Crumbs — Brown butter oat cookies",
};
const T = (id, url, extra = {}) => ({ id, profileId: "default", url, title: url ? TITLES[new URL(url).hostname.split(".")[0]] : "", ...extra });

function build(file, tabs, active, settings, frame = [80, 60, 1360, 860]) {
  const s = session({
    profiles: [
      { id: "default", name: "Personal", color: "plum", icon: "🪐" },
      { id: "work", name: "Work", color: "blue", icon: null },
    ],
    windows: [{ id: "w1", frame, profileId: "default", activeTabIds: { default: active } }],
    tabs,
  });
  s.settings = { appearance: "dark", searchSuggestions: false, warnBeforeQuitting: false, sidebarWidth: 260, ...settings };
  writeFileSync(join(out, file), JSON.stringify(s, null, 2));
}

const TABS = [
  T("t1", "http://moodwall.example/"),
  T("t2", "http://docpad.example/"),
  T("t3", "http://lexicon.example/"),
];

build("session-0244n3-field.json", [...TABS, T("n1", "")], "n1", { addressBar: "sidebar", commandBarPlacement: "centred" });

build("session-0244n3-profiles.json", TABS, "t1", {}, [80, 60, 760, 540]);
