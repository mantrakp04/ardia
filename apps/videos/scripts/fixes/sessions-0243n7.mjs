import { join } from "node:path";
import { DARK, ensureMedia, sites, writeSession } from "./sessions-lib.mjs";

const media = [
  ["cinema.example/img/clip.mp4", ["-loop", "1", "-i", join(sites, "moodwall.example/img/2.jpg"), "-vf", "scale=2400:-2,crop=1920:1080:(in_w-1920)*t/12:(in_h-1080)/2,format=yuv420p", "-t", "12", "-r", "30", "-c:v", "libx264", "-crf", "22", "-movflags", "+faststart"]],
  ["watch.example/img/talk.mp4", ["-stream_loop", "16", "-i", join(sites, "cinema.example/img/clip.mp4"), "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=22050:duration=204", "-af", "volume=0.2", "-t", "204", "-c:v", "libx264", "-crf", "26", "-c:a", "aac", "-shortest", "-movflags", "+faststart"]],
];
ensureMedia(media);
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
writeSession("session-0243n7.json", { tabs, active: "t4", settings: DARK });
