import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { session } from "../../../../scripts/lib/instance.mjs";

export const out = process.argv[2];
export const sites = join(dirname(fileURLToPath(import.meta.url)), "../capture/sites");
export const FRAME = [80, 60, 1360, 860];
export const PERSONAL = { id: "default", name: "Personal", color: "plum", icon: "🪐" };
export const WORK = { id: "work", name: "Work", color: "blue", icon: "🔥" };
export const TRAVEL = { id: "travel", name: "Travel", color: "orange", icon: "✈️" };
export const DARK = { appearance: "dark", searchSuggestions: false, warnBeforeQuitting: false, sidebarWidth: 260 };
export const TITLES = {
  moodwall: "moodwall — ideas for everything",
  docpad: "Trip plan — Docpad",
  lexicon: "meadow | Lexicon dictionary",
  crumbs: "Crumbs — Brown butter oat cookies",
  dailyledger: "The Daily Ledger",
};
export const hostOf = (url) => new URL(url).hostname.split(".")[0];

export function writeSession(file, { profiles = [PERSONAL], tabs, groups, active, activeTabIds, frame = FRAME, windows, windowExtra = {}, settings = DARK, extra = {} }) {
  const s = session({
    profiles,
    windows: windows ?? [{ id: "w1", frame, profileId: "default", activeTabIds: activeTabIds ?? { default: active }, ...windowExtra }],
    tabs,
    ...(groups ? { groups } : {}),
  });
  Object.assign(s, extra);
  s.settings = settings;
  writeFileSync(join(out, file), JSON.stringify(s, null, 2));
  return s;
}

export function ensureMedia(media) {
  for (const [file, args] of media) {
    const path = join(sites, file);
    if (existsSync(path)) continue;
    mkdirSync(dirname(path), { recursive: true });
    execFileSync("ffmpeg", ["-nostdin", "-v", "error", "-y", ...args, path]);
  }
}
