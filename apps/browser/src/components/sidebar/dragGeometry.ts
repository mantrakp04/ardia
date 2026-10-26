import type { ScrollView, View } from "react-native";
import { layout } from "../ui/theme";
import { currentSettings } from "../../state/browser/current";
import { createDragMarks, dragMarksOf, markDrag } from "../../state/sidebar/dragMarks";
import { overPins, pinGrid, pinSlot, TILE_GAP } from "./pinZone";
import { SCROLL_EDGE } from "./ScrollEdge";
import { apart, PIN_SLOT, ROW_GAP, type Drop, type Frame, type Ghost, type Item, type Pointed } from "./dragModel";

export class DragGeometry {
  items = new Map<string, Item>();
  regions = new Map<string, View | null>();
  root: View | null = null;
  scroll: ScrollView | null = null;
  scrollY = 0;
  tilesFixed = true;
  tilesRoom = Infinity;
  setGhost: (ghost: Ghost | null) => void = () => {};
  marks = createDragMarks();
  setSources = (sources: Set<string>) => markDrag(this.marks, { sources });
  setLanding = (landing: string | null) => markDrag(this.marks, { landing });

  protected sources: Item[] = [];
  protected startScrollY = 0;
  protected rootFrame: Frame = { x: 0, y: 0, w: 0, h: 0 };
  protected regionFrames = new Map<string, Frame | null>();
  protected viewport: Frame | null = null;
  protected grab = { x: 0, y: 0 };
  protected pointer = { x: 0, y: 0 };
  protected ghost: Ghost | null = null;
  protected gapKey: string | null = null;
  protected pitch = 0;
  protected into: string | null = null;
  protected dropKey = "";
  protected drop: Drop = { type: "none" };
  protected scrollTimer: ReturnType<typeof setInterval> | undefined;
  protected measured = false;
  protected gridBase: Frame | null = null;
  protected gridGrowth = 0;
  protected token: object | null = null;
  protected external = 0;
  protected escapable = false;
  protected holdKey: string | null = null;
  protected holdReady: string | null = null;
  protected holdTimer: ReturnType<typeof setTimeout> | undefined;
  landed: { key: string; x: number; y: number } | null = null;

  protected still(i: Item): boolean {
    return (this.tilesFixed && i.section === "tiles") || i.section === "folder";
  }

  protected at(f: Frame | null, fixed = false): Frame | null {
    if (!f) return null;
    if (fixed) return f;
    const below = !!this.gridBase && (this.tilesFixed || f.y >= this.gridBase.y + this.gridBase.h);
    return { ...f, y: f.y - (this.scrollY - this.startScrollY) + (below ? this.gridGrowth : 0) };
  }

  protected pinFloor(live: Item[], tiles: Frame): number {
    const list = this.at(this.regionFrames.get("list") ?? null);
    const pinnedArea = this.at(this.regionFrames.get("pinnedGroups") ?? null);
    const rows = live.filter((i) => i.kind !== "tail" && (i.section === "pinnedRows" || i.section === "pinnedGroups")).map((i) => this.at(i.frame)!.y);
    const top = Math.min(list?.y ?? tiles.y + tiles.h + TILE_GAP, pinnedArea?.y ?? Infinity, ...rows);
    return this.tilesFixed ? Math.max(top, tiles.y + tiles.h + this.gridGrowth + SCROLL_EDGE.gap + SCROLL_EDGE.line) : top;
  }

  protected overPinnedRows(y: number): boolean {
    const list = this.at(this.regionFrames.get("list") ?? null);
    return !!list && overPins(y, list.y, this.rowPinning);
  }

  protected inGrid(i: Item) {
    return i.section === "tiles" && !!this.gridBase;
  }

  protected get pinning() {
    return this.drop.type === "tabs" && this.drop.placement.pinned && !this.drop.placement.row;
  }

  protected get rowPinning() {
    return this.drop.type === "tabs" && this.drop.placement.pinned && !!this.drop.placement.row;
  }

  protected shown(i: Item): Frame {
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

  protected ontoTarget(live: Item[], y: number, section: "list" | "pinnedRows"): string | null {
    for (const i of live) {
      if (i.kind !== "row" || i.parentGroup || i.section !== section) continue;
      const f = this.shown(i);
      if (y > f.y + f.h * 0.25 && y < f.y + f.h * 0.75) return i.key;
    }
    return null;
  }

  protected pointed(tiles: Frame, cells: Item[], count: number, home: number | null, x: number, y: number, folders: boolean): Pointed | null {
    const marks = dragMarksOf(this.marks);
    if (!this.gridBase) return null;
    if (!marks.pins && home === null) count = 0;
    const total = cells.length + count;
    if (!total) return null;
    const balanced = currentSettings().balancedTopApps;
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
}
