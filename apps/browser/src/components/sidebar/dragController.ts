import { Animated, type View } from "react-native";
import { NO_DROP } from "../../state/drag/drops";
import { dropTabs } from "../../state/pins/actions";
import { movingTabsFrom } from "../../state/sidebar/current";
import type { TabPlacement } from "../../state/pins/placing";
import { SLIDE } from "../tabstrip/stripReorder";
import { beginTabDrag, cancelTabDrag, endTabDrag, setDragPicture, updateTabDrag } from "../../state/drag/tabDrag";
import { arrangeLive } from "../../state/sidebar/pinnedOrder";
import { suppressHover } from "../../state/sidebar/hover";
import { closeFolderPanel } from "../../state/sidebar/tileFolderUi";
import { dragMarksOf, markDrag } from "../../state/sidebar/dragMarks";
import { boxed, type Drop, EDGE, type Item, measure, ROW_GAP, spring, tabCell } from "./dragModel";
import { DragTargeting } from "./dragTargeting";
import { type DragSession, newDragSession } from "./dragGeometry";
import { setDragEscapeCapture } from "../../state/drag/dragNative";
import { entryKey } from "../../state/sidebar/entryKey";

export class DragController extends DragTargeting {
  create(key: string): Item {
    return { key, kind: "row", tabIds: [], section: "list", view: null, header: null, gap: new Animated.Value(0), size: new Animated.Value(0), frame: null, headerFrame: null };
  }

  get active() {
    return !!this.session?.sources.length;
  }

  async begin(key: string, x: number, y: number) {
    const item = this.items.get(key);
    if (!item || item.kind === "tail") return;
    const lead = tabCell(item) ? item.tabIds[0] : undefined;
    const moving = lead ? movingTabsFrom(lead) : [];
    const sources = moving.length > 1 ? [...this.items.values()].filter((i) => tabCell(i) && i.tabIds.some((id) => moving.includes(id))) : [item];
    this.stopTimers();
    const session = (this.session = newDragSession(sources, { x, y }, this.scrollY));
    this.token = {};
    suppressHover(true);
    session.escapable = true;
    setDragEscapeCapture(true);
    let seq = 0;
    if (tabCell(item)) {
      const single = sources.length === 1 ? (item.tabIds[0] ?? null) : null;
      seq = beginTabDrag(single, [...new Set(sources.flatMap((i) => i.tabIds))]);
    }
    await this.measureAll(session);
    if (this.session !== session) return;
    const frame = item.frame ?? { x, y, w: 176, h: 33 };
    const grab = (session.grab = { x: x - frame.x, y: y - frame.y });
    const count = new Set(sources.flatMap((s) => s.tabIds)).size;
    const height = boxed(item) ? Math.min(frame.h, item.headerFrame?.h ?? 33) : frame.h;
    if (seq) setDragPicture(seq, () => [session.pointer.x - grab.x, session.pointer.y - grab.y, frame.w, height], [x, y]);
    session.ghost = {
      item,
      count,
      width: frame.w,
      height,
      position: new Animated.ValueXY({ x: frame.x - this.rootFrame.x, y: frame.y - this.rootFrame.y }),
    };
    const closing = sources.filter((s) => s.kind !== "tile");
    for (const s of closing) s.size.setValue(s.frame?.h ?? 0);
    this.setLanding(null);
    this.setSources(new Set(sources.map((s) => s.key)));
    this.setGhost(session.ghost);
    if (boxed(item) && !item.collapsed) markDrag(this.marks, { folded: item.key });
    Animated.parallel(closing.map((s) => spring(s.size, 0))).start();
    session.measured = true;
    this.move(session.pointer.x, session.pointer.y);
  }

  async beginExternal(count: number, x: number, y: number) {
    if (this.active && !this.session!.external) return;
    this.reset();
    this.setGhost(null);
    const session = (this.session = newDragSession([this.create("external")], { x, y }, this.scrollY));
    session.external = Math.max(1, count);
    this.token = {};
    suppressHover(true);
    await this.measureAll(session);
    if (this.session !== session) return;
    this.setLanding(null);
    session.measured = true;
    this.move(session.pointer.x, session.pointer.y);
  }

  finishExternal(commit: boolean): TabPlacement | null {
    const session = this.session;
    if (!session?.external) return null;
    const drop = session.measured ? session.drop : NO_DROP;
    this.reset();
    this.token = null;
    this.setLanding(null);
    return commit && drop.type === "tabs" ? drop.placement : null;
  }

  async tilesLaidOut() {
    const session = this.session;
    const frame = await measure(this.regions.get("tiles") ?? null);
    if (!session || this.session !== session) return;
    session.regionFrames.set("tiles", frame);
    this.retarget();
  }

  protected async measureAll(session: DragSession) {
    const [rootFrame, viewport] = await Promise.all([measure(this.root), measure(this.scroll as unknown as View)]);
    this.rootFrame = rootFrame ?? this.rootFrame;
    session.viewport = viewport;
    session.startScrollY = this.scrollY;
    await Promise.all(
      [...this.items.values()].map(async (i) => {
        [i.frame, i.headerFrame] = await Promise.all([measure(i.view), measure(i.header)]);
      }),
    );
    for (const [name, view] of this.regions) session.regionFrames.set(name, await measure(view));
    const grid = [...this.items.values()].some((i) => i.kind === "tile");
    session.gridBase = grid ? (session.regionFrames.get("tiles") ?? null) : null;
    session.gridGrowth = 0;
  }

  move(x: number, y: number) {
    const session = this.session;
    if (session) session.pointer = { x, y };
    updateTabDrag(x, y);
    if (!session?.measured || (!session.ghost && !session.external)) return;
    if (session.ghost) session.ghost.position.setValue({ x: this.ghostX(x), y: y - session.grab.y - this.rootFrame.y });
    this.autoScroll(y);
    this.retarget();
  }

  end(commit: boolean) {
    const session = this.session;
    if (session?.external) return void this.finishExternal(false);
    if (!session?.sources.length) return;
    const { sources, drop, ghost, measured, into } = session;
    const splitDrop = commit ? endTabDrag() : (cancelTabDrag(), false);
    const folded = dragMarksOf(this.marks).folded;
    const leftPanel = sources[0]?.section === "folder" && dragMarksOf(this.marks).folderAway;
    const unfold = () => {
      if (folded && dragMarksOf(this.marks).folded === folded) markDrag(this.marks, { folded: null });
    };
    const spot =
      !splitDrop && measured && ghost && sources.length === 1 && sources[0]!.kind !== "tile" && sources[0]!.section !== "folder" && !into && drop.type !== "onto" && drop.type !== "folder"
        ? this.landingSpot(commit ? drop : { type: "none" })
        : null;
    if (commit && !splitDrop && measured && sources.length) {
      dropTabs(sources.flatMap((i) => i.tabIds), drop);
      if (drop.sequence) arrangeLive(drop.sequence);
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

  protected stopTimers() {
    clearInterval(this.session?.scrollTimer);
    this.clearHold();
  }

  protected reset() {
    const session = this.session;
    this.stopTimers();
    for (const i of this.items.values()) {
      i.gap.stopAnimation();
      i.gap.setValue(0);
    }
    for (const i of session?.sources ?? []) i.size.stopAnimation();
    this.session = null;
    if (session?.escapable) setDragEscapeCapture(false);
    suppressHover(false);
    this.setSources(new Set());
    markDrag(this.marks, { dropInto: null, onto: null, pins: false, pinCount: 0, pinBefore: null, folderTarget: null, folderAway: false });
  }

  protected landingSpot(drop: Drop): Promise<{ x: number; y: number } | null> | null {
    const { sources, gapKey } = this.drag;
    const source = sources[0]!;
    if (drop.type === "tabs" && drop.placement.pinned && !drop.placement.row) return null;
    const target = drop.type !== "none" && gapKey ? this.items.get(gapKey) : undefined;
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
    const group = source.parentGroup ? this.items.get(entryKey("group", source.parentGroup)) : undefined;
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

  protected autoScroll(y: number) {
    const session = this.drag;
    const v = session.viewport;
    const speed = !v ? 0 : y < v.y + EDGE ? -Math.ceil((v.y + EDGE - y) / 4) : y > v.y + v.h - EDGE ? Math.ceil((y - (v.y + v.h - EDGE)) / 4) : 0;
    clearInterval(session.scrollTimer);
    session.scrollTimer = undefined;
    if (!speed || !this.scroll) return;
    session.scrollTimer = setInterval(() => {
      const next = Math.max(0, this.scrollY + speed);
      if (next === this.scrollY) return;
      this.scroll?.scrollTo({ y: next, animated: false });
      this.scrollY = next;
      this.retarget();
    }, 16);
  }

  protected ghostX(x: number): number {
    const left = x - this.drag.grab.x - this.rootFrame.x;
    const source = this.drag.sources[0];
    const home = source?.frame;
    if (!home || !source || !boxed(source)) return left;
    return home.x - this.rootFrame.x;
  }
}
