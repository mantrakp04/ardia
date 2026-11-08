import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { session } from "../../../../scripts/lib/instance.mjs";

const out = process.argv[2];
const TITLES = {
  mail: "Inbox — Mailbox",
  chat: "Pinecone",
  notes: "Notes",
  forum: "Threadly",
  lexicon: "meadow | Lexicon dictionary",
  crumbs: "Crumbs — Brown butter oat cookies",
  dailyledger: "The Daily Ledger",
  docpad: "Trip plan — Docpad",
  moodwall: "moodwall — ideas for everything",
  trails: "Ridge Trail Map",
};
const ICONS = { mail: "favicon.svg", chat: "favicon.svg", notes: "favicon.svg", forum: "favicon.svg", trails: "favicon.svg" };
const host = (url) => new URL(url).hostname.split(".")[0];
const icon = (url) => `${url}${ICONS[host(url)] ?? "favicon.ico"}`;
const T = (id, url, extra = {}) => ({ id, profileId: "default", url, title: TITLES[host(url)], favicon: icon(url), ...extra });
const tile = (id, url, extra = {}) => T(id, url, { pinned: true, pinnedUrl: url, ...extra });
const row = (id, url, extra = {}) => tile(id, url, { pinnedAsRow: true, ...extra });

function build(file, { tabs, active, frame = [80, 60, 1360, 860], settings = {}, groups = [], profiles = [{ id: "default", name: "Personal", color: "plum" }], activeTabIds }) {
  const s = session({
    profiles,
    windows: [{ id: "w1", frame, profileId: "default", activeTabIds: activeTabIds ?? { default: active } }],
    tabs,
    groups,
  });
  s.settings = { appearance: "dark", searchSuggestions: false, warnBeforeQuitting: false, warnBeforeClosingWindow: true, sidebarWidth: 260, ...settings };
  writeFileSync(join(out, file), JSON.stringify(s, null, 2));
}

const TILES = [tile("p1", "http://mail.example/"), tile("p2", "http://crumbs.example/"), tile("p3", "http://lexicon.example/")];
const ROWS = [row("r1", "http://chat.example/")];
const OPEN = [T("t1", "http://forum.example/"), T("t2", "http://docpad.example/"), T("t3", "http://moodwall.example/"), T("t4", "http://dailyledger.example/"), T("t5", "http://trails.example/")];
const READING = { id: "g1", windowId: "w1", profileId: "default", name: "Weekend", icon: "🌿", color: "green", collapsed: false, pinned: false, tabIds: ["t4", "t5"], createdAt: 1 };

build("session-0245n4-close.json", { tabs: [...TILES, ...ROWS, ...OPEN], active: "t2", groups: [READING], frame: [80, 60, 920, 600] });

const SYMBOL = (name) => `symbol:${name}`;
const PROFILES = [
  { id: "default", name: "Personal", color: "plum", icon: SYMBOL("house.fill") },
  { id: "work", name: "Work", color: "blue", icon: SYMBOL("briefcase.fill"), dataId: "default" },
  { id: "school", name: "School", color: "green", icon: SYMBOL("graduationcap.fill"), dataId: "default" },
  { id: "music", name: "Music", color: "orange", icon: SYMBOL("music.note"), dataId: "default" },
  { id: "travel", name: "Travel", color: "red", icon: SYMBOL("airplane"), dataId: "default" },
];
const perProfile = [
  ["default", "http://docpad.example/"],
  ["work", "http://mail.example/"],
  ["school", "http://lexicon.example/"],
  ["music", "http://moodwall.example/"],
  ["travel", "http://trails.example/"],
];
build("session-0245n4-icons.json", {
  tabs: perProfile.flatMap(([profileId, url], i) => [T(`a${i}`, url, { profileId }), T(`b${i}`, "http://dailyledger.example/", { profileId })]),
  profiles: PROFILES,
  activeTabIds: Object.fromEntries(perProfile.map(([profileId], i) => [profileId, `a${i}`])),
  settings: { profileSwitcherIcons: true },
});
