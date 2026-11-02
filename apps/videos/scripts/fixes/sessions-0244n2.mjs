import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { session } from "../../../../scripts/lib/instance.mjs";

const out = process.argv[2];
const TITLES = {
  moodwall: "moodwall — ideas for everything",
  docpad: "Trip plan — Docpad",
  lexicon: "meadow | Lexicon dictionary",
  crumbs: "Crumbs — Brown butter oat cookies",
  chat: "Pinecone · Sam Rivera",
};
const T = (id, url, extra = {}) => ({ id, profileId: "default", url, title: TITLES[new URL(url).hostname.split(".")[0]], ...extra });

function build(file, tabs, active) {
  const s = session({
    profiles: [{ id: "default", name: "Personal", color: "plum", icon: "🪐" }],
    windows: [{ id: "w1", frame: [80, 60, 1360, 860], profileId: "default", activeTabIds: { default: active } }],
    tabs,
  });
  s.settings = { appearance: "dark", searchSuggestions: false, warnBeforeQuitting: false, sidebarWidth: 260 };
  writeFileSync(join(out, file), JSON.stringify(s, null, 2));
}

build("session-0244n2-group.json", [
  T("t1", "http://moodwall.example/"),
  T("t2", "http://docpad.example/"),
  T("t3", "http://lexicon.example/"),
  T("t4", "http://crumbs.example/"),
], "t1");

build("session-0244n2-notify.json", [
  T("t1", "http://docpad.example/"),
  T("c1", "http://chat.example/", { muted: true }),
  T("t3", "http://moodwall.example/"),
], "t1");
