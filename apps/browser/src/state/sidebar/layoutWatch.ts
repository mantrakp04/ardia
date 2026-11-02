import { writeDocument } from "../../platform/documents";
import { sidebarEntries } from "./entries";
import { shownPinnedEntries } from "./pinnedFold";
import { rowIds, rowView } from "./sidebarUi";
import { useBrowser } from "../browser/store";
import { parseEntry } from "./entryKey";
import { focusedWindowOf } from "../windows/ui";

const WATCH_MS = 8000;
const MOVED = 0.5;

type Place = { x: number; y: number; width: number; height: number; commit: number };
type Move = { row: string; from: Place; to: Place };

const last = new Map<string, Place>();
const shown = new Set<string>();
const moves: Move[] = [];
let commits = 0;
let started = 0;
let finished = false;

function onScreen(p: Place, frame: readonly number[] | null | undefined): boolean {
  if (!p.width || !p.height) return false;
  const [width, height] = frame ? [frame[2]!, frame[3]!] : [Infinity, Infinity];
  return p.x >= 0 && p.x + p.width <= width + 1 && p.y + p.height > 0 && p.y < height;
}

function seen(key: string, place: Place, frame: readonly number[] | null | undefined) {
  const before = last.get(key);
  if (before && before.commit > place.commit) return;
  if (before && shown.has(key) && (Math.abs(before.x - place.x) > MOVED || Math.abs(before.y - place.y) > MOVED)) moves.push({ row: key, from: before, to: place });
  last.set(key, place);
  if (onScreen(place, frame)) shown.add(key);
}

function missingRows(): string[] {
  const s = useBrowser.getState();
  const missing: string[] = [];
  for (const windowId of s.windowOrder) {
    const w = s.windows[windowId];
    if (!w || !w.sidebarOpen) continue;
    const { tiles, pinned: all, list } = sidebarEntries(s, windowId, w.profileId);
    const pinned = shownPinnedEntries(s, windowId, w.profileId, all);
    const ids = [...tiles, ...[...pinned, ...list].map((e) => (parseEntry(e).kind === "split" ? e : parseEntry(e).id))];
    for (const id of ids) if (!rowView(windowId, id)) missing.push(`${windowId}|${id}`);
  }
  return missing;
}

let edits: string[] = [];
function edit() {
  const s = useBrowser.getState();
  const windowId = focusedWindowOf(s) ?? s.windowOrder[0];
  const w = windowId ? s.windows[windowId] : undefined;
  if (!w) return;
  const mine = w.tabIds.filter((id) => s.tabs[id]?.profileId === w.profileId && !s.tabs[id]?.pin);
  const added = s.newTab(w.id, { url: "about:blank#layout-edit", background: true });
  s.moveTab(added, 0);
  const closed = mine[3];
  if (closed) s.closeTab(closed);
  const moved = mine[mine.length - 1];
  if (moved) s.moveTab(moved, 1);
  edits = [`added ${added}`, `closed ${closed}`, `moved ${moved}`];
}

function finish() {
  if (finished) return;
  finished = true;
  writeDocument("layout-watch.json", JSON.stringify({ commits, rows: last.size, shown: shown.size, ms: Date.now() - started, moves, missing: missingRows(), edits }));
}

export function layoutCommitted(editAt = 0) {
  if (finished) return;
  if (!started) {
    started = Date.now();
    setTimeout(finish, WATCH_MS);
  }
  const commit = ++commits;
  if (commit === editAt) setTimeout(edit, 0);
  const s = useBrowser.getState();
  for (const windowId of s.windowOrder) {
    const frame = s.windows[windowId]?.frame;
    for (const id of rowIds(windowId)) {
      rowView(windowId, id)?.measureInWindow((x, y, width, height) => seen(`${windowId}|${id}`, { x, y, width, height, commit }, frame));
    }
  }
}
