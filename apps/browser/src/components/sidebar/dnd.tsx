import { hapticTick, onAppEvent, setDragEscapeCapture } from "@ardia/shell";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Animated, Easing, PanResponder, type ScrollView, type View } from "react-native";
import { create, useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { layout, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useWindowId } from "../../store/hooks";
import { descendantIds } from "../../store/groups";
import { canMoveGroup, type GroupPlacement, type TabPlacement } from "../../store/organize";
import { SLIDE } from "../layout/stripReorder";
import { beginTabDrag, cancelTabDrag, endTabDrag, setDragPicture, updateTabDrag, useTabDrag } from "../layout/tabDrag";
import { useClipped, type ClipSource } from "./entryMotion";
import { arrangeLive } from "./pinnedOrder";
import { suppressHover } from "./hover";
import { overPins, pinGrid, pinGridHeight, pinSlot, TILE_GAP } from "./pinZone";
import { SCROLL_EDGE } from "./ScrollEdge";
import { closeFolderPanel, folderPanel } from "./tileFolderUi";
import { addToTileFolder, folderIdOfCell } from "../../store/tileFolders";

type Frame = { x: number; y: number; w: number; h: number };
type Section = "tiles" | "pinnedRows" | "pinnedGroups" | "list" | "folder";

type ItemSpec = {
  kind: "tile" | "row" | "group" | "split" | "tail" | "live";
  tabIds: string[];
  section: Section;
  groupId?: string;
  parentGroup?: string;
  collapsed?: boolean;
  foldedHeight?: () => number;
  liveFolderId?: string;
  folderId?: string;
};

type Item = ItemSpec & {
  key: string;
  view: View | null;
  header: View | null;
  gap: Animated.Value;
  size: Animated.Value;
  frame: Frame | null;
  headerFrame: Frame | null;
};

type Drop =
  | { type: "tabs"; placement: TabPlacement; sequence?: string[] }
  | { type: "group"; placement: GroupPlacement; sequence?: string[] }
  | { type: "live"; sequence: string[] }
  | { type: "onto"; targetId: string }
  | { type: "folder"; ontoId: string; beforeId?: string | null }
  | { type: "none" };

const blockKind = (i: Item) => i.kind === "row" || i.kind === "group" || i.kind === "live" || i.kind === "split";
const pinnedBlock = (i: Item) => (i.section === "pinnedRows" || i.section === "pinnedGroups") && !i.parentGroup && blockKind(i);
const boxed = (i: Item) => i.kind === "group" || i.kind === "live";
const apart = (a: Item, b: Item) => a.section !== b.section && (a.section === "folder" || b.section === "folder");
export const cellKey = (cell: string) => {
  const folderId = folderIdOfCell(cell);
  return folderId ? `tf:${folderId}` : `t:${cell}`;
};

export type Ghost = { item: Item; count: number; width: number; height: number; position: Animated.ValueXY; landing?: boolean };

const ROW_GAP = layout.rowGap;
export const PIN_SLOT = layout.pinnedHeight + TILE_GAP;
const EDGE = 28;
const FOLDER_HOLD_MS = 400;
const spring = (value: Animated.Value, toValue: number) => Animated.spring(value, { toValue, ...SLIDE });

const inside = (f: Frame, x: number, y: number, slop = 0) => x >= f.x - slop && x <= f.x + f.w + slop && y >= f.y - slop && y <= f.y + f.h + slop;
const measure = (view: View | null): Promise<Frame | null> =>
  view
    ? new Promise((resolve) => view.measureInWindow((x, y, w, h) => resolve(w || h ? { x, y, w, h } : null)))
    : Promise.resolve(null);

type Marks = {
  sources: Set<string>;
  dropInto: string | null;
  onto: string | null;
  landing: string | null;
  pins: boolean;
  pinCount: number;
  pinBefore: string | null;
  folded: string | null;
  folderTarget: string | null;
  folderAway: boolean;
};
const NO_MARKS: Marks = { sources: new Set(), dropInto: null, onto: null, landing: null, pins: false, pinCount: 0, pinBefore: null, folded: null, folderTarget: null, folderAway: false };
const noMarks = create<Marks>()(() => NO_MARKS);
const NO_DROP: Drop = { type: "none" };
type Pointed = { cell: Item | null; index: number; gap: number; part: "gap" | "centre" | "before" | "after" };

class DragController {
  items = new Map<string, Item>();
  regions = new Map<string, View | null>();
  root: View | null = null;
  scroll: ScrollView | null = null;
  scrollY = 0;
  tilesFixed = true;
  tilesRoom = Infinity;
  setGhost: (ghost: Ghost | null) => void = () => {};
  marks = create<Marks>()(() => NO_MARKS);
  setSources = (sources: Set<string>) => this.marks.setState({ sources });
  setLanding = (landing: string | null) => this.marks.setState({ landing });

  private sources: Item[] = [];
  private startScrollY = 0;
  private rootFrame: Frame = { x: 0, y: 0, w: 0, h: 0 };
  private regionFrames = new Map<string, Frame | null>();
  private viewport: Frame | null = null;
  private grab = { x: 0, y: 0 };
  private pointer = { x: 0, y: 0 };
  private ghost: Ghost | null = null;
  private gapKey: string | null = null;
  private pitch = 0;
  private into: string | null = null;
  private dropKey = "";
  private drop: Drop = { type: "none" };
  private scrollTimer: ReturnType<typeof setInterval> | undefined;
  private measured = false;
  private gridBase: Frame | null = null;
  private gridGrowth = 0;
  private token: object | null = null;
  private external = 0;
  private escapable = false;
  private holdKey: string | null = null;
  private holdReady: string | null = null;
  private holdTimer: ReturnType<typeof setTimeout> | undefined;
  landed: { key: string; x: number; y: number } | null = null;

  create(key: string): Item {
    return { key, kind: "row", tabIds: [], section: "list", view: null, header: null, gap: new Animated.Value(0), size: new Animated.Value(0), frame: null, headerFrame: null };
  }

  get active() {
    return this.sources.length > 0;
  }

  async begin(key: string, x: number, y: number, selection: string[]) {
    const item = this.items.get(key);
    if (!item || item.kind === "tail") return;
    const selected = item.kind === "row" || item.kind === "tile" ? selection : [];
    const multi = selected.length > 1 && item.tabIds.some((id) => selected.includes(id));
    this.sources = multi
      ? [...this.items.values()].filter((i) => (i.kind === "row" || i.kind === "tile") && !i.folderId && i.tabIds.some((id) => selected.includes(id)))
      : [item];
    const token = (this.token = {});
    suppressHover(true);
    this.escapable = true;
    setDragEscapeCapture(true);
    let seq = 0;
    if ((item.kind === "row" || item.kind === "tile") && !item.folderId) {
      const single = this.sources.length === 1 ? (item.tabIds[0] ?? null) : null;
      seq = beginTabDrag(single, [...new Set(this.sources.flatMap((i) => i.tabIds))]);
    }
    this.pointer = { x, y };
    this.measured = false;
    this.startScrollY = this.scrollY;
    await this.measureAll();
    if (this.token !== token || !this.sources.length) return;
    const frame = item.frame ?? { x, y, w: 176, h: 33 };
    this.grab = { x: x - frame.x, y: y - frame.y };
    const count = new Set(this.sources.flatMap((s) => s.tabIds)).size;
    const height = boxed(item) ? Math.min(frame.h, item.headerFrame?.h ?? 33) : frame.h;
    if (seq) setDragPicture(seq, () => [this.pointer.x - this.grab.x, this.pointer.y - this.grab.y, frame.w, height], [x, y]);
    this.ghost = {
      item,
      count,
      width: frame.w,
      height,
      position: new Animated.ValueXY({ x: frame.x - this.rootFrame.x, y: frame.y - this.rootFrame.y }),
    };
    const closing = this.sources.filter((s) => s.kind !== "tile");
    for (const s of closing) s.size.setValue(s.frame?.h ?? 0);
    this.setLanding(null);
    this.setSources(new Set(this.sources.map((s) => s.key)));
    this.setGhost(this.ghost);
    if (boxed(item) && !item.collapsed) this.marks.setState({ folded: item.key });
    Animated.parallel(closing.map((s) => spring(s.size, 0))).start();
    this.measured = true;
    this.move(this.pointer.x, this.pointer.y);
  }

  async beginExternal(count: number, x: number, y: number) {
    if (this.active && !this.external) return;
    this.reset();
    this.setGhost(null);
    this.external = Math.max(1, count);
    this.sources = [this.create("external")];
    const token = (this.token = {});
    suppressHover(true);
    this.pointer = { x, y };
    this.measured = false;
    await this.measureAll();
    if (this.token !== token || !this.external) return;
    this.setLanding(null);
    this.measured = true;
    this.move(this.pointer.x, this.pointer.y);
  }

  finishExternal(commit: boolean): TabPlacement | null {
    if (!this.external) return null;
    const drop = this.measured ? this.drop : NO_DROP;
    this.reset();
    this.token = null;
    this.setLanding(null);
    return commit && drop.type === "tabs" ? drop.placement : null;
  }

  async tilesLaidOut() {
    const token = this.token;
    const frame = await measure(this.regions.get("tiles") ?? null);
    if (this.token !== token || !this.sources.length) return;
    this.regionFrames.set("tiles", frame);
    this.retarget();
  }

  private async measureAll() {
    const [rootFrame, viewport] = await Promise.all([measure(this.root), measure(this.scroll as unknown as View)]);
    this.rootFrame = rootFrame ?? this.rootFrame;
    this.viewport = viewport;
    this.startScrollY = this.scrollY;
    await Promise.all(
      [...this.items.values()].map(async (i) => {
        [i.frame, i.headerFrame] = await Promise.all([measure(i.view), measure(i.header)]);
      }),
    );
    for (const [name, view] of this.regions) this.regionFrames.set(name, await measure(view));
    const grid = [...this.items.values()].some((i) => i.kind === "tile");
    this.gridBase = grid ? (this.regionFrames.get("tiles") ?? null) : null;
    this.gridGrowth = 0;
  }

  move(x: number, y: number) {
    this.pointer = { x, y };
    updateTabDrag(x, y);
    if (!this.measured || (!this.ghost && !this.external)) return;
    if (this.ghost) this.ghost.position.setValue({ x: this.ghostX(x), y: y - this.grab.y - this.rootFrame.y });
    this.autoScroll(y);
    this.retarget();
  }

  end(commit: boolean) {
    if (this.external) return void this.finishExternal(false);
    if (!this.sources.length) return;
    const sources = this.sources;
    const drop = this.drop;
    const ghost = this.ghost;
    const splitDrop = commit ? endTabDrag() : (cancelTabDrag(), false);
    const folded = this.marks.getState().folded;
    const leftPanel = sources[0]?.section === "folder" && this.marks.getState().folderAway;
    const unfold = () => {
      if (folded && this.marks.getState().folded === folded) this.marks.setState({ folded: null });
    };
    const spot =
      !splitDrop && this.measured && ghost && sources.length === 1 && sources[0]!.kind !== "tile" && sources[0]!.section !== "folder" && !this.into && drop.type !== "onto" && drop.type !== "folder"
        ? this.landingSpot(commit ? drop : { type: "none" })
        : null;
    if (commit && !splitDrop && this.measured && sources.length) {
      const s = useBrowser.getState();
      const ids = sources.flatMap((i) => i.tabIds);
      if (drop.type === "tabs") s.placeTabs(ids, drop.placement);
      else if (drop.type === "group" && sources[0]!.groupId) s.moveGroup(sources[0]!.groupId, drop.placement);
      else if (drop.type === "onto") s.groupOnto(ids, drop.targetId);
      else if (drop.type === "folder") useBrowser.setState((now) => addToTileFolder(now, ids, drop.ontoId, drop.beforeId));
      if ((drop.type === "tabs" || drop.type === "group" || drop.type === "live") && drop.sequence) arrangeLive(drop.sequence);
    }
    this.reset();
    if (leftPanel) closeFolderPanel();
    if (!spot || !ghost) {
      this.token = null;
      this.setLanding(null);
      this.setGhost(null);
      unfold();
      return;
    }
    const token = (this.token = {});
    this.setLanding(ghost.item.key);
    this.setGhost({ ...ghost, landing: true });
    const done = () => {
      unfold();
      if (this.token !== token) return;
      this.token = null;
      this.setLanding(null);
      this.setGhost(null);
    };
    void spot.then((at) => {
      if (this.token !== token) return unfold();
      if (__DEV__) this.landed = at && { key: ghost.item.key, x: at.x, y: at.y };
      if (!at) return done();
      Animated.spring(ghost.position, { toValue: { x: at.x - this.rootFrame.x, y: at.y - this.rootFrame.y }, ...SLIDE }).start(done);
    });
  }

  private reset() {
    clearInterval(this.scrollTimer);
    this.scrollTimer = undefined;
    this.clearHold();
    for (const i of this.items.values()) {
      i.gap.stopAnimation();
      i.gap.setValue(0);
    }
    for (const i of this.sources) i.size.stopAnimation();
    this.sources = [];
    this.gapKey = null;
    this.pitch = 0;
    this.dropKey = "";
    this.drop = NO_DROP;
    this.into = null;
    this.ghost = null;
    this.measured = false;
    this.gridBase = null;
    this.gridGrowth = 0;
    this.external = 0;
    if (this.escapable) setDragEscapeCapture(false);
    this.escapable = false;
    suppressHover(false);
    this.setSources(new Set());
    this.marks.setState({ dropInto: null, onto: null, pins: false, pinCount: 0, pinBefore: null, folderTarget: null, folderAway: false });
  }

  private clearHold() {
    clearTimeout(this.holdTimer);
    this.holdTimer = undefined;
    this.holdKey = null;
    this.holdReady = null;
  }

  private holdOver(target: Item) {
    if (this.holdKey === target.key) return;
    this.clearHold();
    this.holdKey = target.key;
    if (target.folderId) return void (this.holdReady = target.key);
    this.holdTimer = setTimeout(() => {
      if (this.holdKey !== target.key || !this.sources.length) return;
      this.holdReady = target.key;
      this.retarget();
    }, FOLDER_HOLD_MS);
  }

  private pointed(tiles: Frame, cells: Item[], count: number, home: number | null, x: number, y: number, folders: boolean): Pointed | null {
    const marks = this.marks.getState();
    if (!this.gridBase) return null;
    if (!marks.pins && home === null) count = 0;
    const total = cells.length + count;
    if (!total) return null;
    const balanced = useBrowser.getState().settings.balancedTopApps;
    const slot = pinSlot(tiles, total, layout.pinnedHeight, x, y, balanced);
    const found = !marks.pins ? (home ?? cells.length) : marks.pinBefore === "tail:tiles" ? cells.length : cells.findIndex((c) => c.key === marks.pinBefore);
    const gap = found < 0 ? cells.length : found;
    const index = slot < gap ? slot : slot >= gap + count ? slot - count : -1;
    const cell = index >= 0 ? cells[index] : undefined;
    if (!cell) return { cell: null, index: gap, gap, part: "gap" };
    const { columns, width } = pinGrid(total, tiles.w, balanced);
    const mid = tiles.x + (slot % columns) * (width + TILE_GAP) + width / 2;
    const top = tiles.y + Math.floor(slot / columns) * PIN_SLOT;
    const reach = this.holdReady === cell.key ? 0.45 : 0.3;
    const centre = folders && Math.abs(x - mid) < width * reach && Math.abs(y - (top + layout.pinnedHeight / 2)) <= (layout.pinnedHeight + TILE_GAP) / 2;
    return { cell, index, gap, part: centre ? "centre" : x < mid ? "before" : "after" };
  }

  private landingSpot(drop: Drop): Promise<{ x: number; y: number } | null> | null {
    const source = this.sources[0]!;
    if (drop.type === "tabs" && drop.placement.pinned && !drop.placement.row) return null;
    const target = drop.type !== "none" && this.gapKey ? this.items.get(this.gapKey) : undefined;
    const ref = target ?? source;
    const top = ref.frame?.y;
    if (top === undefined) return null;
    const now = (v: Animated.Value) => {
      let value = 0;
      v.stopAnimation((x) => (value = x));
      return value;
    };
    let closing = 0;
    for (const i of this.items.values()) if (i.frame && i.section !== "tiles" && (i === ref || i.frame.y < top)) closing += now(i.gap);
    const group = source.parentGroup ? this.items.get(`g:${source.parentGroup}`) : undefined;
    const emptied = !!group && group.tabIds.every((id) => source.tabIds.includes(id)) && !!group.frame && group.frame.y < top && group !== ref;
    if (!emptied && source !== ref && source.frame && source.frame.y < top)
      closing += source.parentGroup ? Math.max(0, now(source.size) - ROW_GAP) + ROW_GAP : now(source.size);
    const container = ref.kind === "tail" ? [...this.items.values()].find((i) => i !== source && i.kind !== "tail" && i.frame && i.section === ref.section && i.parentGroup === ref.parentGroup) : ref;
    const home = target ? null : this.at(source.frame, this.still(source));
    if (home) return Promise.resolve({ x: home.x, y: home.y });
    return Promise.all([measure(ref.view), emptied ? measure(group!.view) : null]).then(([f, gone]) => {
      if (!f) return null;
      return { x: container?.frame?.x ?? f.x, y: f.y - closing - (gone ? gone.h + ROW_GAP : 0) + (ref.kind === "tail" ? ROW_GAP : 0) };
    });
  }

  private autoScroll(y: number) {
    const v = this.viewport;
    const speed = !v ? 0 : y < v.y + EDGE ? -Math.ceil((v.y + EDGE - y) / 4) : y > v.y + v.h - EDGE ? Math.ceil((y - (v.y + v.h - EDGE)) / 4) : 0;
    clearInterval(this.scrollTimer);
    this.scrollTimer = undefined;
    if (!speed || !this.scroll) return;
    this.scrollTimer = setInterval(() => {
      const next = Math.max(0, this.scrollY + speed);
      if (next === this.scrollY) return;
      this.scroll?.scrollTo({ y: next, animated: false });
      this.scrollY = next;
      this.retarget();
    }, 16);
  }

  private ghostX(x: number): number {
    const left = x - this.grab.x - this.rootFrame.x;
    const source = this.sources[0];
    const home = source?.frame;
    if (!home || !source || !boxed(source)) return left;
    return home.x - this.rootFrame.x;
  }

  private still(i: Item): boolean {
    return (this.tilesFixed && i.section === "tiles") || i.section === "folder";
  }

  private at(f: Frame | null, fixed = false): Frame | null {
    if (!f) return null;
    if (fixed) return f;
    const below = !!this.gridBase && (this.tilesFixed || f.y >= this.gridBase.y + this.gridBase.h);
    return { ...f, y: f.y - (this.scrollY - this.startScrollY) + (below ? this.gridGrowth : 0) };
  }

  private pinFloor(live: Item[], tiles: Frame): number {
    const list = this.at(this.regionFrames.get("list") ?? null);
    const pinnedArea = this.at(this.regionFrames.get("pinnedGroups") ?? null);
    const rows = live.filter((i) => i.kind !== "tail" && (i.section === "pinnedRows" || i.section === "pinnedGroups")).map((i) => this.at(i.frame)!.y);
    const top = Math.min(list?.y ?? tiles.y + tiles.h + TILE_GAP, pinnedArea?.y ?? Infinity, ...rows);
    return this.tilesFixed ? Math.max(top, tiles.y + tiles.h + this.gridGrowth + SCROLL_EDGE.gap + SCROLL_EDGE.line) : top;
  }

  private overPinnedRows(y: number): boolean {
    const list = this.at(this.regionFrames.get("list") ?? null);
    return !!list && overPins(y, list.y, this.rowPinning);
  }

  private retarget() {
    const { x, y } = this.pointer;
    const source = this.sources[0]!;
    const sourceKeys = new Set(this.sources.map((s) => s.key));
    const subtree = source.kind === "group" && source.groupId ? new Set([source.groupId, ...descendantIds(useBrowser.getState().groups, source.groupId)]) : null;
    const live = [...this.items.values()].filter(
      (i) => !sourceKeys.has(i.key) && i.frame && !(subtree && ((i.parentGroup && subtree.has(i.parentGroup)) || (i.groupId && subtree.has(i.groupId)))),
    );
    const cy = (i: Item) => {
      const f = this.shown(i);
      return f.y + Math.min(f.h, i.headerFrame?.h ?? f.h) / 2;
    };
    const byY = (a: Item, b: Item) => this.at(a.frame, this.still(a))!.y - this.at(b.frame, this.still(b))!.y || a.frame!.x - b.frame!.x;
    const dragged = new Set(this.sources.flatMap((s) => s.tabIds));
    const firstTab = (i: Item | undefined) => i?.tabIds.find((id) => !dragged.has(id)) ?? null;
    const tabsDrag = source.kind === "row" || source.kind === "tile";
    const count = this.external || (source.folderId ? 1 : dragged.size);
    const rowPitch = (boxed(source) ? (source.foldedHeight?.() ?? this.ghost?.height ?? layout.rowHeight) : layout.rowHeight * (source.kind === "split" ? 1 : Math.max(1, this.ghost?.count ?? this.external ?? 1))) + ROW_GAP;
    const blocks = live.filter(pinnedBlock).sort(byY);
    const rest = blocks.map((b) => b.key);
    const moved = this.sources
      .filter((s) => s.frame)
      .sort(byY)
      .flatMap((s) => (s.kind === "group" || s.kind === "live" || s.kind === "split" ? [s.key] : s.tabIds.map((id) => `t:${id}`)));
    const pinnedAt = (): { before: Item | undefined; beforeId: string | null; sequence: string[] } => {
      const before = blocks.find((b) => cy(b) > y);
      const at = before ? blocks.indexOf(before) : blocks.length;
      const next = blocks.slice(at).find((b) => firstTab(b) !== null);
      return { before, beforeId: firstTab(next), sequence: [...rest.slice(0, at), ...moved, ...rest.slice(at)] };
    };
    let drop: Drop = { type: "none" };
    let gapKey: string | null = null;
    let pitch = rowPitch;
    let into: string | null = null;
    let onto: string | null = null;
    let folderTarget: string | null = null;
    let folderAway = false;

    const sidebar = this.viewport ?? this.rootFrame;
    const tiles = this.at(this.regionFrames.get("tiles") ?? null, this.tilesFixed);
    const balanced = useBrowser.getState().settings.balancedTopApps;
    const away = x > sidebar.x + sidebar.w + 40 || x < sidebar.x - 40 || useTabDrag.getState().outside;
    const cells = live.filter((i) => i.kind === "tile").sort(byY);
    const overTiles = !away && tabsDrag && !!tiles && (this.gridBase ? overPins(y, this.pinFloor(live, tiles), this.pinning) : inside(tiles, x, y, 6));
    if (this.gridBase)
      this.gridGrowth = Math.min(pinGridHeight(cells.length + (overTiles ? count : 0), this.gridBase.w, layout.pinnedHeight, balanced), this.tilesFixed ? this.tilesRoom : Infinity) - this.gridBase.h;
    const list = this.at(this.regionFrames.get("list") ?? null);
    const inPinned = !!list && y < list.y;
    const panel = folderPanel();
    const panelFrame = panel ? (this.regionFrames.get("folder") ?? null) : null;
    const wasAway = this.marks.getState().folderAway;
    const inPanel = !away && !wasAway && tabsDrag && !this.external && !!panelFrame && inside(panelFrame, x, y);
    if (source.section === "folder" && !inPanel) folderAway = true;
    const canFolder = tabsDrag && !this.external && !source.folderId;
    const home = source.section === "tiles" && source.frame ? cells.filter((c) => byY(c, source) < 0).length : null;
    const spot = !away && tabsDrag && overTiles && tiles ? this.pointed(tiles, cells, count, home, x, y, canFolder) : null;
    const target = spot?.part === "centre" ? spot.cell : null;
    if (target) this.holdOver(target);
    else this.clearHold();
    if (away) {
      drop = { type: "none" };
    } else if (inPanel && panel) {
      const members = live.filter((i) => i.section === "folder" && i.kind !== "tail").sort(byY);
      const before = members.find((m) => cy(m) > y);
      const anchor = members.find((m) => firstTab(m) !== null);
      drop = anchor ? { type: "folder", ontoId: firstTab(anchor)!, beforeId: firstTab(before) } : { type: "none" };
      gapKey = anchor ? (before?.key ?? "tail:folder") : null;
    } else if (target && this.holdReady === target.key) {
      drop = { type: "folder", ontoId: firstTab(target)! };
      gapKey = this.gapKey;
      pitch = this.pitch;
      folderTarget = target.key;
    } else if (overTiles && tiles) {
      const index = !spot ? Math.min(cells.length, pinSlot(tiles, cells.length + count, layout.pinnedHeight, x, y, balanced)) : spot.part === "after" ? spot.index + 1 : spot.part === "before" ? spot.index : spot.gap;
      const before = this.gridBase ? cells[index] : undefined;
      drop = { type: "tabs", placement: { pinned: true, row: false, beforeId: firstTab(before), ...(source.folderId ? {} : { tileFolder: null }) }, sequence: rest };
      gapKey = before?.key ?? "tail:tiles";
      pitch = PIN_SLOT;
    } else {
      const hits =
        tabsDrag || source.kind === "group" || source.kind === "split"
          ? live
              .filter((i) => i.kind === "group")
              .flatMap((g) => {
                const f = this.shown(g);
                const start = this.at(g.headerFrame);
                const header = start && { ...start, y: start.y + f.y - this.at(g.frame)!.y };
                const onHeader = !!header && inside(header, x, y) && Math.abs(y - (header.y + header.h / 2)) < header.h / 3;
                if (g.collapsed || (source.kind === "group" && onHeader)) return onHeader ? [{ g, into: true, h: f.h }] : [];
                return inside(f, x, y) && (!header || y > header.y + header.h / 2) ? [{ g, into: false, h: f.h }] : [];
              })
              .sort((a, z) => a.h - z.h)
          : [];
      const hit = hits[0];
      const nestAt = (groupId: string, beforeId: string | null): Drop =>
        source.kind !== "group"
          ? { type: "tabs", placement: { pinned: false, groupId, beforeId }, sequence: rest }
          : { type: "group", placement: { pinned: false, parentId: groupId, beforeId }, sequence: rest };
      if (hit?.into) {
        drop = nestAt(hit.g.groupId!, null);
        into = hit.g.groupId!;
      } else if (hit) {
        const members = live.filter((i) => (i.kind === "row" || i.kind === "group" || i.kind === "split") && i.parentGroup === hit.g.groupId).sort(byY);
        const before = members.find((m) => cy(m) > y);
        drop = nestAt(hit.g.groupId!, firstTab(before));
        gapKey = before?.key ?? `tail:group:${hit.g.groupId}`;
      } else if ((onto = tabsDrag && !this.external ? this.ontoTarget(live, y, this.overPinnedRows(y) ? "pinnedRows" : "list") : null)) {
        drop = { type: "onto", targetId: this.items.get(onto)!.tabIds[0]! };
        gapKey = this.gapKey;
        pitch = this.pitch;
      } else if ((tabsDrag || source.kind === "split") && this.overPinnedRows(y)) {
        const { before, beforeId, sequence } = pinnedAt();
        drop = { type: "tabs", placement: { pinned: true, row: true, beforeId, ...(beforeId ? {} : { last: true }) }, sequence };
        gapKey = before?.key ?? "tail:pinnedGroups";
      } else if ((source.kind === "group" || source.kind === "live") && inPinned) {
        const { before, beforeId, sequence } = pinnedAt();
        drop = source.kind === "live" ? { type: "live", sequence } : { type: "group", placement: { pinned: true, parentId: null, beforeId }, sequence };
        gapKey = before?.key ?? "tail:pinnedGroups";
      } else if (source.kind !== "live") {
        const items = live.filter((i) => i.section === "list" && !i.parentGroup && i.kind !== "tail" && i.kind !== "tile").sort(byY);
        const before = items.find((b) => cy(b) > y && firstTab(b) !== null);
        gapKey = before?.key ?? "tail:list";
        drop =
          source.kind === "group"
            ? { type: "group", placement: { pinned: false, parentId: null, beforeId: firstTab(before) }, sequence: rest }
            : { type: "tabs", placement: { pinned: false, beforeId: firstTab(before) }, sequence: rest };
      }
    }
    const refused = drop.type === "group" && !!source.groupId && !canMoveGroup(useBrowser.getState().groups, source.groupId, drop.placement);
    if (refused || (source.kind === "split" && drop.type === "tabs" && drop.placement.pinned && !drop.placement.row)) {
      drop = { type: "none" };
      gapKey = null;
      into = null;
    }
    if (drop.type !== "onto") onto = null;

    if (folderAway !== this.marks.getState().folderAway) this.marks.setState({ folderAway });
    const key = JSON.stringify(drop);
    if (key === this.dropKey && gapKey === this.gapKey) return;
    if (this.dropKey && drop.type !== "none" && useBrowser.getState().settings.tabReorderHaptics) hapticTick();
    this.dropKey = key;
    this.drop = drop;
    this.into = into;
    const pins = drop.type === "tabs" && drop.placement.pinned && !drop.placement.row;
    const held = drop.type === "folder" && !inPanel;
    this.marks.setState({ dropInto: into, onto, folderTarget, pins: pins || held, pinCount: pins || held ? count : 0, pinBefore: pins || held ? gapKey : null });
    if (gapKey !== this.gapKey) {
      const prev = this.gapKey && this.items.get(this.gapKey);
      if (prev && !this.inGrid(prev)) spring(prev.gap, 0).start();
      const next = gapKey && this.items.get(gapKey);
      if (next && !this.inGrid(next)) spring(next.gap, pitch).start();
      this.gapKey = gapKey;
      this.pitch = pitch;
    }
  }

  private inGrid(i: Item) {
    return i.section === "tiles" && !!this.gridBase;
  }

  private get pinning() {
    return this.drop.type === "tabs" && this.drop.placement.pinned && !this.drop.placement.row;
  }

  private get rowPinning() {
    return this.drop.type === "tabs" && this.drop.placement.pinned && !!this.drop.placement.row;
  }

  private shown(i: Item): Frame {
    const f = this.at(i.frame, this.still(i))!;
    if (!this.dropKey) return f;
    const [top, bottom] = [i.frame!.y, i.frame!.y + i.frame!.h];
    let dy = 0;
    let dh = 0;
    const gap = this.gapKey ? this.items.get(this.gapKey) : undefined;
    if (gap?.frame && gap.section !== "tiles" && !apart(gap, i)) {
      if (gap.frame.y <= top) dy += this.pitch;
      else if (gap.frame.y < bottom) dh += this.pitch;
    }
    for (const s of this.sources) {
      if (s.kind === "tile" || !s.frame || s === i || apart(s, i)) continue;
      const closed = s.frame.h + (s.parentGroup ? 0 : ROW_GAP);
      if (s.frame.y < top) dy -= closed;
      else if (s.frame.y < bottom) dh -= closed;
    }
    return { ...f, y: f.y + dy, h: f.h + dh };
  }

  private ontoTarget(live: Item[], y: number, section: "list" | "pinnedRows"): string | null {
    for (const i of live) {
      if (i.kind !== "row" || i.parentGroup || i.section !== section) continue;
      const f = this.shown(i);
      if (y > f.y + f.h * 0.25 && y < f.y + f.h * 0.75) return i.key;
    }
    return null;
  }
}

const DragContext = createContext<DragController | null>(null);

export function DragProvider({ children }: { children: (ghost: Ghost | null, controller: DragController) => ReactNode }) {
  const controller = useMemo(() => new DragController(), []);
  if (__DEV__) (globalThis as { sidebarDrag?: DragController }).sidebarDrag = controller;
  const [ghost, setGhost] = useState<Ghost | null>(null);
  controller.setGhost = setGhost;
  useEffect(() => () => void (controller.active && controller.end(false)), [controller]);
  useEffect(() => {
    const sub = onAppEvent((e) => e.type === "dragEscape" && controller.active && controller.end(false));
    return () => sub.remove();
  }, [controller]);
  return (
    <DragContext.Provider value={controller}>
      {children(ghost, controller)}
      <WindowDropHighlight />
    </DragContext.Provider>
  );
}

function WindowDropHighlight() {
  const windowId = useWindowId();
  const theme = useTheme();
  const over = useTabDrag((d) => d.overWindow === windowId);
  const glow = useMemo(() => new Animated.Value(0), []);
  useEffect(() => {
    Animated.timing(glow, { toValue: over ? 1 : 0, duration: 140, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [over]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: 5,
        right: 5,
        top: 44,
        bottom: 6,
        borderRadius: 10,
        borderWidth: 1.5,
        borderColor: theme.accent,
        backgroundColor: theme.dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
        opacity: glow,
      }}
    />
  );
}

export function DragScope({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const controller = useContext(DragContext);
  return <DragContext.Provider value={enabled ? controller : null}>{children}</DragContext.Provider>;
}

export const useDragController = () => useContext(DragContext) ?? undefined;
export const useDropInto = () => useStore(useContext(DragContext)?.marks ?? noMarks, (m) => m.dropInto);
export const useDropOnto = (key: string) => useStore(useContext(DragContext)?.marks ?? noMarks, (m) => m.onto === key);
export const useDropPins = () => useStore(useContext(DragContext)?.marks ?? noMarks, (m) => m.pins);
export const usePinSlots = (cells: string[]) =>
  useStore(
    useContext(DragContext)?.marks ?? noMarks,
    useShallow((m) => {
      let slot = 0;
      return cells.map((cell) => {
        const key = cellKey(cell);
        if (m.pinBefore === key) slot += m.pinCount;
        return m.sources.has(key) ? slot : slot++;
      });
    }),
  );
export const usePinnedCount = (cells: string[]) =>
  useStore(useContext(DragContext)?.marks ?? noMarks, (m) => cells.reduce((n, cell) => n + (m.sources.has(cellKey(cell)) ? 0 : 1), 0) + m.pinCount);
export const useFolderTarget = (key: string) => useStore(useContext(DragContext)?.marks ?? noMarks, (m) => m.folderTarget === key);
export const useFolderAway = () => useStore(useContext(DragContext)?.marks ?? noMarks, (m) => m.folderAway);
export const useDragFolded = (key: string) => useStore(useContext(DragContext)?.marks ?? noMarks, (m) => m.folded === key);
export const useDragging = () => useStore(useContext(DragContext)?.marks ?? noMarks, (m) => m.sources.size > 0);

export function useDragItem(key: string, spec: ItemSpec, selection: () => string[] = () => [], clip: ClipSource | null = null) {
  const controller = useContext(DragContext) ?? undefined;
  const marks = controller?.marks ?? noMarks;
  const item = useMemo(() => controller?.create(key), [controller, key]);
  if (item) Object.assign(item, spec);
  useEffect(() => {
    if (!controller || !item) return;
    controller.items.set(key, item);
    return () => {
      if (controller.items.get(key) === item) controller.items.delete(key);
    };
  }, [controller, item, key]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => spec.kind !== "tail" && Math.hypot(g.dx, g.dy) > 4,
        onPanResponderGrant: (_, g) => void controller?.begin(key, g.x0, g.y0, selection()),
        onPanResponderMove: (_, g) => controller?.move(g.moveX, g.moveY),
        onPanResponderRelease: () => controller?.end(true),
        onPanResponderTerminate: () => controller?.end(false),
        onPanResponderTerminationRequest: () => false,
      }),
    [controller, key],
  );
  const ref = useCallback(
    (view: View | null) => {
      if (item) item.view = view;
    },
    [item],
  );
  const headerRef = useCallback(
    (view: View | null) => {
      if (item) item.header = view;
    },
    [item],
  );

  const source = useStore(marks, (m) => m.sources.has(key));
  const landing = useStore(marks, (m) => m.landing === key);
  const clipped = useClipped(clip);
  const horizontal = spec.kind === "tile";
  const tailOffset = useMemo(() => item && Animated.add(item.gap, -ROW_GAP), [item]);
  const style = item
    ? {
        ...(horizontal ? null : { marginTop: spec.kind === "tail" ? tailOffset! : item.gap }),
        ...(source
          ? horizontal
            ? { opacity: 0 }
            : { height: item.size, marginBottom: -ROW_GAP, opacity: 0, overflow: "hidden" as const }
          : landing
            ? { opacity: 0 }
            : {}),
        ...(clipped && !source && !landing ? { marginTop: -ROW_GAP, paddingTop: ROW_GAP, overflow: "hidden" as const } : {}),
      }
    : {};
  return { wrapper: { ref, style }, handle: responder.panHandlers, headerRef, dragging: source, gap: item?.gap };
}
