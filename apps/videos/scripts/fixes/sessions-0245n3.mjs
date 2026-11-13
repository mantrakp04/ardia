import { DARK, hostOf, TITLES, writeSession } from "./sessions-lib.mjs";

const TITLES_HERE = { ...TITLES, mail: "Inbox — Mailbox", chat: "Pinecone", notes: "Notes", forum: "Threadly", trails: "Ridge Trail Map" };
const ICONS = { mail: "favicon.svg", chat: "favicon.svg", notes: "favicon.svg", forum: "favicon.svg", trails: "favicon.svg" };
const icon = (url) => `${url}${ICONS[hostOf(url)] ?? "favicon.ico"}`;
const T = (id, url, extra = {}) => ({ id, profileId: "default", url, title: TITLES_HERE[hostOf(url)], favicon: icon(url), ...extra });
const tile = (id, url, extra = {}) => T(id, url, { pinned: true, pinnedUrl: url, ...extra });
const row = (id, url, extra = {}) => tile(id, url, { pinnedAsRow: true, ...extra });
const NEAR_BLACK = { r: 0.02, g: 0.02, b: 0.02, a: 1 };
const flat = (color) => ({ stops: [{ x: 0.2, y: 0.2, color }, { x: 0.8, y: 0.8, color }], intensity: 0.6, mode: "dark", grain: 0, texture: "grain", translucency: 1 });

function build(file, { tabs, active, frame, settings = {}, profiles = [{ id: "default", name: "Personal", color: "plum" }], activeTabIds, tabLayout }) {
  writeSession(file, { profiles, tabs, active, activeTabIds, frame, windowExtra: tabLayout ? { tabLayout } : {}, settings: { ...DARK, ...(tabLayout ? { tabLayout } : {}), ...settings } });
}

const TILES = [tile("p1", "http://mail.example/"), tile("p2", "http://crumbs.example/"), tile("p3", "http://lexicon.example/")];
const ROWS = [row("r1", "http://chat.example/"), row("r2", "http://notes.example/")];
const TABS = [T("t1", "http://forum.example/"), T("t2", "http://docpad.example/"), T("t3", "http://moodwall.example/"), T("t4", "http://dailyledger.example/")];

for (const [name, active] of [["apps", "p1"], ["notes", "r2"], ["doc", "t2"], ["forum", "t1"]]) build(`session-0245n3-${name}.json`, { tabs: [...TILES, ...ROWS, ...TABS], active, settings: { peekLinksToOtherSites: true } });

const SPACES = [
  { id: "default", name: "Personal", color: "plum", icon: "🪐", shareTopApps: true },
  { id: "work", name: "Work", color: "blue", icon: "🔥", dataId: "default", shareTopApps: true },
];
build("session-0245n3-spaces.json", {
  tabs: [...TILES, T("t1", "http://moodwall.example/"), T("t2", "http://docpad.example/"), T("w1t", "http://dailyledger.example/", { profileId: "work" }), T("w2t", "http://forum.example/", { profileId: "work" })],
  profiles: SPACES,
  activeTabIds: { default: "t1", work: "w1t" },
});

build("session-0245n3-black.json", {
  tabs: [...TILES, T("t1", "http://dailyledger.example/"), T("t2", "http://docpad.example/"), T("t3", "http://moodwall.example/"), T("t4", "http://forum.example/")],
  active: "t1",
  profiles: [{ id: "default", name: "Night", color: "neutral", theme: flat(NEAR_BLACK) }],
});
