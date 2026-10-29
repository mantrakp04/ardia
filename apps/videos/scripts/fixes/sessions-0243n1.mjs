import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { session } from "../../../../scripts/lib/instance.mjs";

const out = process.argv[2];
const sites = join(dirname(fileURLToPath(import.meta.url)), "../capture/sites");
const media = [
  ["tunes.example/img/tone.wav", ["-f", "lavfi", "-i", "sine=frequency=220:sample_rate=22050:duration=90", "-af", "volume=0.3"]],
  ["cinema.example/img/clip.mp4", ["-loop", "1", "-i", join(sites, "moodwall.example/img/2.jpg"), "-vf", "scale=2400:-2,crop=1920:1080:(in_w-1920)*t/12:(in_h-1080)/2,format=yuv420p", "-t", "12", "-r", "30", "-c:v", "libx264", "-crf", "22", "-movflags", "+faststart"]],
];
for (const [file, args] of media) {
  const path = join(sites, file);
  if (existsSync(path)) continue;
  mkdirSync(dirname(path), { recursive: true });
  execFileSync("ffmpeg", ["-nostdin", "-v", "error", "-y", ...args, path]);
}
const T = (profileId, url, extra = {}) => ({ profileId, url, ...extra });
const pin = (url) => T("default", url, { pinned: true, pinnedAsRow: true, pinnedUrl: url });
const profiles = [
  { id: "default", name: "Personal", color: "plum", icon: "🪐" },
  { id: "work", name: "Work", color: "blue", icon: "🔥" },
  { id: "travel", name: "Travel", color: "orange", icon: "✈️" },
];
const settings = { appearance: "light", searchSuggestions: false, warnBeforeQuitting: false };

function build(file, tabs, extra = {}) {
  const s = session({
    profiles,
    windows: [{ id: "w1", frame: [80, 60, 1360, 860], profileId: "default", ...(extra.window ?? {}) }],
    tabs: tabs.map((t, i) => ({ id: `t${i + 1}`, ...t })),
  });
  s.windows[0].activeTabIds = { default: extra.active ?? "t3", work: `t${tabs.findIndex((t) => t.profileId === "work") + 1}`, travel: `t${tabs.findIndex((t) => t.profileId === "travel") + 1}` };
  s.settings = { ...settings, ...(extra.settings ?? {}) };
  writeFileSync(join(out, file), JSON.stringify(s, null, 2));
}

const everyday = [
  pin("http://lexicon.example/"),
  pin("http://dailyledger.example/"),
  T("default", "http://moodwall.example/"),
  T("default", "http://docpad.example/"),
  T("default", "http://crumbs.example/"),
  T("default", "http://lexicon.example/"),
  T("work", "http://docpad.example/"),
  T("travel", "http://crumbs.example/"),
];
build("session.json", everyday);
build("session-top.json", everyday, { settings: { tabLayout: "top" } });
build("session-player.json", [
  pin("http://lexicon.example/"),
  pin("http://dailyledger.example/"),
  T("default", "http://moodwall.example/"),
  T("default", "http://tunes.example/"),
  T("default", "http://docpad.example/"),
  T("work", "http://docpad.example/"),
  T("travel", "http://crumbs.example/"),
], { active: "t4" });
build("session-cinema.json", [
  pin("http://lexicon.example/"),
  pin("http://dailyledger.example/"),
  T("default", "http://cinema.example/"),
  T("default", "http://moodwall.example/"),
  T("work", "http://docpad.example/"),
  T("travel", "http://crumbs.example/"),
], { window: { sidebarOpen: false } });
build("session-signin.json", [
  pin("http://lexicon.example/"),
  pin("http://dailyledger.example/"),
  T("default", "http://signin.example/"),
  T("default", "http://moodwall.example/"),
  T("work", "http://docpad.example/"),
  T("travel", "http://crumbs.example/"),
]);
build("session-frame.json", everyday, { window: { sidebarOpen: false } });
