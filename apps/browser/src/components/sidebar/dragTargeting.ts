import { layout } from "../ui/theme";
import { currentSettings } from "../../state/browser/current";
import type { DragSource, DropSpot } from "../../state/drag/drops";
import { descendantGroupIds, resolveDropNow } from "../../state/sidebar/current";
import { tabDragOutside } from "../../state/drag/tabDrag";
import { dragMarksOf, markDrag } from "../../state/sidebar/dragMarks";
import { folderPanel } from "../../state/sidebar/tileFolderUi";
import { overPins, pinGridHeight, pinSlot } from "./pinZone";
import { boxed, FOLDER_HOLD_MS, inside, pinnedBlock, PIN_SLOT, ROW_GAP, spring, type Drop, type Item } from "./dragModel";
import { DragGeometry } from "./dragGeometry";
import { hapticTick } from "../../state/drag/dragNative";

export class DragTargeting extends DragGeometry {
  protected clearHold() {
    clearTimeout(this.holdTimer);
    this.holdTimer = undefined;
    this.holdKey = null;
    this.holdReady = null;
  }

  protected holdOver(target: Item) {
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

  protected retarget() {
    const { x, y } = this.pointer;
    const source = this.sources[0]!;
    const sourceKeys = new Set(this.sources.map((s) => s.key));
    const subtree = source.kind === "group" && source.groupId ? new Set([source.groupId, ...descendantGroupIds(source.groupId)]) : null;
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
    const dragSource: DragSource = {
      kind: source.kind === "group" || source.kind === "split" || source.kind === "live" ? source.kind : "tab",
      groupId: source.groupId,
      folderId: source.folderId,
      external: !!this.external,
    };
    let aim: DropSpot | null = null;
    let sequence: string[] | undefined;
    let gapKey: string | null = null;
    let pitch = rowPitch;
    let into: string | null = null;
    let onto: string | null = null;
    let folderTarget: string | null = null;
    let folderAway = false;

    const sidebar = this.viewport ?? this.rootFrame;
    const tiles = this.at(this.regionFrames.get("tiles") ?? null, this.tilesFixed);
    const balanced = currentSettings().balancedTopApps;
    const away = x > sidebar.x + sidebar.w + 40 || x < sidebar.x - 40 || tabDragOutside();
    const cells = live.filter((i) => i.kind === "tile").sort(byY);
    const overTiles = !away && tabsDrag && !!tiles && (this.gridBase ? overPins(y, this.pinFloor(live, tiles), this.pinning) : inside(tiles, x, y, 6));
    if (this.gridBase)
      this.gridGrowth = Math.min(pinGridHeight(cells.length + (overTiles ? count : 0), this.gridBase.w, layout.pinnedHeight, balanced), this.tilesFixed ? this.tilesRoom : Infinity) - this.gridBase.h;
    const list = this.at(this.regionFrames.get("list") ?? null);
    const inPinned = !!list && y < list.y;
    const panel = folderPanel();
    const panelFrame = panel ? (this.regionFrames.get("folder") ?? null) : null;
    const wasAway = dragMarksOf(this.marks).folderAway;
    const inPanel = !away && !wasAway && tabsDrag && !this.external && !!panelFrame && inside(panelFrame, x, y);
    if (source.section === "folder" && !inPanel) folderAway = true;
    const canFolder = tabsDrag && !this.external && !source.folderId;
    const home = source.section === "tiles" && source.frame ? cells.filter((c) => byY(c, source) < 0).length : null;
    const spot = !away && tabsDrag && overTiles && tiles ? this.pointed(tiles, cells, count, home, x, y, canFolder) : null;
    const target = spot?.part === "centre" ? spot.cell : null;
    if (target) this.holdOver(target);
    else this.clearHold();
    if (away) {
      aim = null;
    } else if (inPanel && panel) {
      const members = live.filter((i) => i.section === "folder" && i.kind !== "tail").sort(byY);
      const before = members.find((m) => cy(m) > y);
      const anchor = members.find((m) => firstTab(m) !== null);
      aim = anchor ? { zone: "folder", ontoId: firstTab(anchor)!, beforeId: firstTab(before) } : null;
      gapKey = anchor ? (before?.key ?? "tail:folder") : null;
    } else if (target && this.holdReady === target.key) {
      aim = { zone: "folder", ontoId: firstTab(target)! };
      gapKey = this.gapKey;
      pitch = this.pitch;
      folderTarget = target.key;
    } else if (overTiles && tiles) {
      const index = !spot ? Math.min(cells.length, pinSlot(tiles, cells.length + count, layout.pinnedHeight, x, y, balanced)) : spot.part === "after" ? spot.index + 1 : spot.part === "before" ? spot.index : spot.gap;
      const before = this.gridBase ? cells[index] : undefined;
      aim = { zone: "tiles", beforeId: firstTab(before) };
      sequence = rest;
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
      if (hit?.into) {
        aim = { zone: "group", groupId: hit.g.groupId!, beforeId: null };
        sequence = rest;
        into = hit.g.groupId!;
      } else if (hit) {
        const members = live.filter((i) => (i.kind === "row" || i.kind === "group" || i.kind === "split") && i.parentGroup === hit.g.groupId).sort(byY);
        const before = members.find((m) => cy(m) > y);
        aim = { zone: "group", groupId: hit.g.groupId!, beforeId: firstTab(before) };
        sequence = rest;
        gapKey = before?.key ?? `tail:group:${hit.g.groupId}`;
      } else if ((onto = tabsDrag && !this.external ? this.ontoTarget(live, y, this.overPinnedRows(y) ? "pinnedRows" : "list") : null)) {
        aim = { zone: "onto", targetId: this.items.get(onto)!.tabIds[0]! };
        gapKey = this.gapKey;
        pitch = this.pitch;
      } else if (((tabsDrag || source.kind === "split") && this.overPinnedRows(y)) || ((source.kind === "group" || source.kind === "live") && inPinned)) {
        const pinned = pinnedAt();
        aim = { zone: "pinnedRows", beforeId: pinned.beforeId };
        sequence = pinned.sequence;
        gapKey = pinned.before?.key ?? "tail:pinnedGroups";
      } else if (source.kind !== "live") {
        const items = live.filter((i) => i.section === "list" && !i.parentGroup && i.kind !== "tail" && i.kind !== "tile").sort(byY);
        const before = items.find((b) => cy(b) > y && firstTab(b) !== null);
        gapKey = before?.key ?? "tail:list";
        aim = { zone: "list", beforeId: firstTab(before) };
        sequence = rest;
      }
    }
    const resolved = resolveDropNow(dragSource, aim);
    const drop: Drop = resolved.type !== "none" && sequence ? { ...resolved, sequence } : resolved;
    if (drop.type === "none") {
      gapKey = null;
      into = null;
    }
    if (drop.type !== "onto") onto = null;

    if (folderAway !== dragMarksOf(this.marks).folderAway) markDrag(this.marks, { folderAway });
    const key = JSON.stringify(drop);
    if (key === this.dropKey && gapKey === this.gapKey) return;
    if (this.dropKey && drop.type !== "none" && currentSettings().tabReorderHaptics) hapticTick();
    this.dropKey = key;
    this.drop = drop;
    this.into = into;
    const pins = drop.type === "tabs" && drop.placement.pinned && !drop.placement.row;
    const held = drop.type === "folder" && !inPanel;
    markDrag(this.marks, { dropInto: into, onto, folderTarget, pins: pins || held, pinCount: pins || held ? count : 0, pinBefore: pins || held ? gapKey : null });
    if (gapKey !== this.gapKey) {
      const prev = this.gapKey && this.items.get(this.gapKey);
      if (prev && !this.inGrid(prev)) spring(prev.gap, 0).start();
      const next = gapKey && this.items.get(gapKey);
      if (next && !this.inGrid(next)) spring(next.gap, pitch).start();
      this.gapKey = gapKey;
      this.pitch = pitch;
    }
  }
}
