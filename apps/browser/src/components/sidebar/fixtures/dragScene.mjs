import { escapeCapture } from "./nativeFakes.mjs";
import { DragController } from "../dragController.ts";
import { cellKey, tailKey } from "../dragModel.ts";
import { pinGrid } from "../pinZone.ts";
import { layout } from "../../ui/theme.ts";
import { animations } from "../../../test-native/reactNative.ts";
import { entryKey } from "../../../state/sidebar/entryKey.ts";
import { dragMarksOf } from "../../../state/sidebar/dragMarks.ts";
import { useBrowser } from "../../../state/browser/store.ts";
import { pinnedAnchors, pinnedAreaKeys } from "../../../state/pins/pinnedArea.ts";
import { live } from "../../../state/live/store.ts";
import { pinSection } from "../../../state/browser/model.ts";
import { tileFolderOf } from "../../../state/pins/tileFolders.ts";

export const ROW = layout.rowHeight;
export const GAP = layout.rowGap;
export const PITCH = ROW + GAP;
export const LEFT = 6;
export const WIDTH = 180;
export const INDENT = 16;
export const TILE = layout.pinnedHeight;
export { animations, entryKey, tailKey, cellKey, escapeCapture };

export const S = () => useBrowser.getState();

export function fakeView(frame) {
  const view = {
    frame,
    held: false,
    pending: [],
    scrolled: [],
    measureInWindow(done) {
      const run = () => {
        const f = typeof view.frame === "function" ? view.frame() : view.frame;
        if (f) done(f.x, f.y, f.w, f.h);
        else done(0, 0, 0, 0);
      };
      if (view.held) view.pending.push(run);
      else run();
    },
    release() {
      const pending = view.pending;
      view.pending = [];
      view.held = false;
      for (const run of pending) run();
    },
    scrollTo({ y }) {
      view.scrolled.push(y);
    },
  };
  return view;
}

const frameAt = (x, y, w, h) => ({ x, y, w, h });

export function sceneLayout({ top = 200, x = LEFT, width = WIDTH } = {}) {
  const entries = [];
  let y = top;
  const place = (key, spec, frame, header = null) => entries.push({ key, spec, frame, header });
  const api = {
    get y() {
      return y;
    },
    skip(dy) {
      y += dy;
      return api;
    },
    row(tabId, { section = "list", parent, depth = parent ? 1 : 0, key = entryKey("tab", tabId) } = {}) {
      place(key, { kind: "row", tabIds: [tabId], section, parentGroup: parent }, frameAt(x + depth * INDENT, y, width - depth * INDENT, ROW));
      y += PITCH;
      return api;
    },
    split(splitId, tabIds, { section = "list", parent, depth = parent ? 1 : 0 } = {}) {
      place(entryKey("split", splitId), { kind: "split", tabIds, section, parentGroup: parent }, frameAt(x + depth * INDENT, y, width - depth * INDENT, ROW));
      y += PITCH;
      return api;
    },
    group(groupId, { section = "list", parent, depth = parent ? 1 : 0, collapsed = false, tabIds = S().groups[groupId]?.tabIds ?? [] }, members = () => {}) {
      const start = y;
      const header = frameAt(x + depth * INDENT, start, width - depth * INDENT, ROW);
      y += PITCH;
      const memberSection = section;
      if (!collapsed) members({ section: memberSection, parent: groupId, depth: depth + 1 });
      const end = y;
      const tailFrame = frameAt(x + (depth + 1) * INDENT, end - GAP, width - (depth + 1) * INDENT, 0);
      if (!collapsed) place(tailKey({ group: groupId }), { kind: "tail", tabIds: [], section, parentGroup: groupId }, tailFrame);
      const spec = { kind: "group", tabIds, section, groupId, collapsed, foldedHeight: () => ROW, parentGroup: parent };
      entries.splice(entries.length - (collapsed ? 0 : 1), 0, { key: entryKey("group", groupId), spec, frame: frameAt(x + depth * INDENT, start, width - depth * INDENT, end - start - GAP), header });
      return api;
    },
    live(folderId, { collapsed = true, rows = 0 } = {}) {
      const h = ROW + (collapsed ? 0 : rows * PITCH);
      place(entryKey("live", folderId), { kind: "live", tabIds: [], section: "pinnedGroups", liveFolderId: folderId, collapsed, foldedHeight: () => ROW }, frameAt(x, y, width, h), frameAt(x, y, width, ROW));
      y += h + GAP;
      return api;
    },
    tail(section) {
      place(tailKey(section), { kind: "tail", tabIds: [], section }, frameAt(x, y - GAP, width, 0));
      return api;
    },
    tiles(cells, { balanced = false, gridWidth = width } = {}) {
      const start = y;
      const { columns, width: tile } = pinGrid(cells.length, gridWidth, balanced);
      cells.forEach((cell, i) => {
        const folder = typeof cell === "object" ? cell : null;
        const column = i % columns;
        const row = Math.floor(i / columns);
        const frame = frameAt(x + column * (tile + 6), start + row * (TILE + 6), tile, TILE);
        if (folder) place(entryKey("tileFolder", folder.folderId), { kind: "tile", tabIds: folder.members, section: "tiles", folderId: folder.folderId }, frame);
        else place(entryKey("tab", cell), { kind: "tile", tabIds: [cell], section: "tiles" }, frame);
      });
      const rows = Math.max(1, Math.ceil(cells.length / columns));
      const h = rows * TILE + (rows - 1) * 6;
      place(tailKey("tiles"), { kind: "tail", tabIds: [], section: "tiles" }, frameAt(x, start + h, width, 0));
      y = start + h;
      return { frame: frameAt(x, start, gridWidth, h), api };
    },
    folderMembers(tabIds) {
      for (const id of tabIds) {
        place(`fm:${id}`, { kind: "row", tabIds: [id], section: "folder" }, frameAt(x, y, width, ROW));
        y += PITCH;
      }
      place(tailKey("folder"), { kind: "tail", tabIds: [], section: "folder" }, frameAt(x, y - GAP, width, 0));
      return api;
    },
    entries,
  };
  return api;
}

export function mount({ entries, regions = {}, root = frameAt(0, 0, 200, 900), viewport = frameAt(0, 100, 200, 700), scrollY = 0, tilesFixed = true, tilesRoom = Infinity }) {
  const c = new DragController();
  const ghosts = [];
  c.setGhost = (g) => ghosts.push(g);
  c.root = fakeView(root);
  c.scroll = fakeView(viewport);
  c.scrollY = scrollY;
  c.tilesFixed = tilesFixed;
  c.tilesRoom = tilesRoom;
  for (const [name, frame] of Object.entries(regions)) c.regions.set(name, fakeView(frame));
  for (const e of entries) {
    const item = c.create(e.key);
    Object.assign(item, e.spec);
    item.view = fakeView(e.frame);
    item.header = e.header ? fakeView(e.header) : e.spec.kind === "group" ? fakeView({ ...e.frame, h: ROW }) : null;
    c.items.set(e.key, item);
  }
  return { c, ghosts, view: (key) => c.items.get(key).view };
}

export const settle = () => new Promise((resolve) => setImmediate(resolve));

export function readDrag(c) {
  const marks = dragMarksOf(c.marks);
  const d = c.session;
  return {
    drop: d?.drop ?? { type: "none" },
    gapKey: d?.gapKey ?? null,
    pitch: d?.pitch ?? 0,
    into: d?.into ?? null,
    external: d?.external ?? 0,
    gridGrowth: d?.gridGrowth ?? 0,
    hold: d?.hold.key ? { key: d.hold.key, ready: d.hold.ready } : null,
    marks: {
      dropInto: marks.dropInto,
      onto: marks.onto,
      pins: marks.pins,
      pinCount: marks.pinCount,
      pinBefore: marks.pinBefore,
      folderTarget: marks.folderTarget,
      folderAway: marks.folderAway,
      folded: marks.folded,
      landing: marks.landing,
      sources: [...marks.sources],
    },
  };
}

export const gaps = (c) => Object.fromEntries([...c.items].filter(([, i]) => i.gap.__getValue() !== 0).map(([k, i]) => [k, i.gap.__getValue()]));

export const centre = (f, dy = 0) => ({ x: f.x + f.w / 2, y: f.y + f.h / 2 + dy });

export async function drag(c, key, from, to) {
  await c.begin(key, from.x, from.y);
  for (const p of [].concat(to)) c.move(p.x, p.y);
  return readDrag(c);
}

export function committed(windowId) {
  const s = S();
  const w = s.windows[windowId];
  const tabs = w.tabIds.map((id) => {
    const t = s.tabs[id];
    return [id, { pinned: pinSection(t) !== "none", row: pinSection(t) === "row", group: t.groupId ?? null, folder: tileFolderOf(t)?.id ?? null }];
  });
  const groups = Object.values(s.groups)
    .filter((g) => g.windowId === windowId)
    .map((g) => [g.id, { tabIds: g.tabIds, parent: g.parentId ?? null, pinned: !!g.pinned, collapsed: !!g.collapsed }]);
  return {
    tabIds: w.tabIds,
    tabs: Object.fromEntries(tabs),
    groups: Object.fromEntries(groups),
    pinnedArea: pinnedAreaKeys(s, w, w.profileId),
    anchors: [...pinnedAnchors(s, w, w.profileId)],
    orderChoices: Object.keys(s.pinChoices[w.profileId] ?? {}).sort(),
    liveOrder: live().folderOrder.map((id) => [id, live().folders[id]?.after ?? null]),
  };
}
