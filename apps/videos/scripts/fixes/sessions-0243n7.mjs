import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { session } from "../../../../scripts/lib/instance.mjs";

const out = process.argv[2];
const sites = join(dirname(fileURLToPath(import.meta.url)), "../capture/sites");
const media = [
  ["cinema.example/img/clip.mp4", ["-loop", "1", "-i", join(sites, "moodwall.example/img/2.jpg"), "-vf", "scale=2400:-2,crop=1920:1080:(in_w-1920)*t/12:(in_h-1080)/2,format=yuv420p", "-t", "12", "-r", "30", "-c:v", "libx264", "-crf", "22", "-movflags", "+faststart"]],
  ["watch.example/img/talk.mp4", ["-stream_loop", "16", "-i", join(sites, "cinema.example/img/clip.mp4"), "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=22050:duration=204", "-af", "volume=0.2", "-t", "204", "-c:v", "libx264", "-crf", "26", "-c:a", "aac", "-shortest", "-movflags", "+faststart"]],
];
for (const [file, args] of media) {
  const path = join(sites, file);
  if (existsSync(path)) continue;
  mkdirSync(dirname(path), { recursive: true });
  execFileSync("ffmpeg", ["-nostdin", "-v", "error", "-y", ...args, path]);
}
const T = (url, extra = {}) => ({ profileId: "default", url, ...extra });
const tile = (url) => T(url, { pinned: true, pinnedUrl: url });
const tabs = [
  tile("http://lexicon.example/"),
  tile("http://dailyledger.example/"),
  tile("http://crumbs.example/"),
  T("http://watch.example/"),
  T("http://docpad.example/"),
  T("http://moodwall.example/"),
].map((t, i) => ({ id: `t${i + 1}`, ...t }));
const s = session({
  profiles: [{ id: "default", name: "Personal", color: "plum", icon: "🪐" }],
  windows: [{ id: "w1", frame: [80, 60, 1360, 860], profileId: "default", activeTabIds: { default: "t4" } }],
  tabs,
});
s.settings = { appearance: "dark", searchSuggestions: false, warnBeforeQuitting: false, sidebarWidth: 260 };
writeFileSync(join(out, "session-0243n7.json"), JSON.stringify(s, null, 2));
