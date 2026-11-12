import { dragPreview, windowFrame, type DragPreviewShape } from "../../platform/windows";
import { hapticTick } from "../../platform/haptics";
import { create } from "zustand";
import { focus } from "../browser/actions";
import { lastPicture, startTabPictures } from "../tabs/tabPictures";
import { webviews } from "../../platform/webviews";
import { useBrowser } from "../browser/store";
import type { Frame } from "../browser/types";
import { tabTitle } from "../browser/model";
import { splitOf, type SplitSide, splitTabIdsOf } from "../splits/splits";
import { dropTabIntoSplit } from "../splits/actions";
import { dropTabsOutside, screenPoint, windowUnder } from "./windowDrop";
import { dropTabsOnBar, followTabDragOnBar } from "../bookmarks/barDrag";

export type DropTarget = { tabId: string; side: SplitSide };
type Insert = { windowId: string; beforeId: string | null };
type Picture = { chip: () => [number, number, number, number]; grab: [number, number] };
type TabDragSession = { seq: number; liveFrame: Frame | null; pointer: [number, number]; picture: Picture | null; sentShape: DragPreviewShape };

export type TabDragging = {
  phase: "tab";
  tabId: string | null;
  tabIds: string[];
  windowId: string;
  x: number;
  y: number;
  lifted: boolean | null;
  onPage: boolean;
  target: DropTarget | null;
  outside: boolean;
  overWindow: string | null;
  overPoint: [number, number] | null;
  insert: Insert | null;
  session: TabDragSession;
};

export type ExternalDragging = {
  phase: "external";
  owner: { windowId: string; token: number };
  overWindow: string;
  overPoint: [number, number];
  insert: Insert | null;
};

export type TabDrag = { phase: "idle" } | TabDragging | ExternalDragging;

const IDLE: TabDrag = { phase: "idle" };

export const useTabDrag = create<TabDrag>()(() => IDLE);

useTabDrag.subscribe(followTabDragOnBar);

if (__DEV__) (globalThis as { acTabDrag?: typeof useTabDrag }).acTabDrag = useTabDrag;

startTabPictures();

let dragSeq = 0;
let previewShown = false;

const tabDragState = (): TabDragging | null => {
  const d = useTabDrag.getState();
  return d.phase === "tab" ? d : null;
};

export const tabDragging = () => useTabDrag.getState().phase !== "idle";

export const tabDragOutside = () => !!tabDragState()?.outside;

export function beginTabDrag(tabId: string | null, tabIds: string[] = tabId ? [tabId] : []): number {
  if (previewShown) dragPreview.cancel();
  previewShown = false;
  const seq = ++dragSeq;
  const windowId = useBrowser.getState().tabs[tabIds[0] ?? ""]?.windowId;
  if (!windowId) {
    useTabDrag.setState(IDLE, true);
    return seq;
  }
  const session: TabDragSession = { seq, liveFrame: null, pointer: [-1, -1], picture: null, sentShape: "hidden" };
  useTabDrag.setState(
    { phase: "tab", tabId, tabIds, windowId, x: -1, y: -1, lifted: null, onPage: false, target: null, outside: false, overWindow: null, overPoint: null, insert: null, session },
    true,
  );
  void windowFrame(windowId)
    .then((frame) => {
      session.liveFrame = frame;
    })
    .catch(() => {});
  return seq;
}

export function updateTabDrag(x: number, y: number, lifted: boolean | null = null) {
  const drag = tabDragState();
  if (!drag) return;
  const { session } = drag;
  const s = useBrowser.getState();
  const { outside, overWindow } = windowUnder(s, drag.windowId, x, y, session.liveFrame);
  if (overWindow && overWindow !== drag.overWindow && s.settings.tabReorderHaptics) hapticTick();
  const screen = overWindow ? screenPoint(s, drag.windowId, x, y, session.liveFrame) : null;
  const over = overWindow ? s.windows[overWindow]?.frame : null;
  const overPoint: [number, number] | null = screen && over ? [screen[0] - over[0], over[1] + over[3] - screen[1]] : null;
  const insert = drag.insert?.windowId === overWindow ? drag.insert : null;
  session.pointer = [x, y];
  if (lifted === false && drag.lifted === false && !outside && !drag.outside) return;
  useTabDrag.setState({ x, y, lifted, outside, overWindow, overPoint, insert });
  syncPreview();
}

const insertResolvers = new Map<string, (point: [number, number]) => string | null | undefined>();
export function setInsertResolver(windowId: string, resolver: ((point: [number, number]) => string | null | undefined) | null) {
  if (resolver) insertResolvers.set(windowId, resolver);
  else insertResolvers.delete(windowId);
}

export function setInsert(windowId: string, beforeId: string | null | undefined) {
  const d = useTabDrag.getState();
  if (d.phase === "idle") return;
  const { overWindow, insert } = d;
  const next = overWindow === windowId && beforeId !== undefined ? { windowId, beforeId } : null;
  if (insert?.windowId === next?.windowId && insert?.beforeId === next?.beforeId) return;
  if (!next && insert?.windowId !== windowId) return;
  useTabDrag.setState({ insert: next });
  syncPreview();
}

function previewShape(d: TabDragging): DragPreviewShape {
  if (d.outside) return d.overWindow && d.insert?.windowId === d.overWindow ? "pill" : "card";
  return (d.lifted ?? d.onPage) ? "card" : "hidden";
}

function syncPreview() {
  const d = tabDragState();
  if (!d) return;
  const { session } = d;
  const shape = previewShape(d);
  if (shape === "hidden" && session.sentShape === "hidden") return;
  if (shape !== "hidden" && session.picture) takePicture(d, session.picture);
  session.sentShape = shape;
  dragPreview.update(shape, session.pointer);
}

export function setDragPicture(drag: number, chip: [number, number, number, number] | (() => [number, number, number, number]), grab: [number, number]) {
  const d = tabDragState();
  if (d?.session.seq !== drag) return;
  const rect = typeof chip === "function" ? chip() : chip;
  d.session.picture = { chip: typeof chip === "function" ? chip : () => chip, grab: [grab[0] - rect[0], grab[1] - rect[1]] };
  syncPreview();
}

function takePicture({ session, windowId, tabId }: TabDragging, { chip, grab }: Picture) {
  session.picture = null;
  previewShown = true;
  const rect = chip();
  dragPreview.begin(windowId, rect, [rect[0] + grab[0], rect[1] + grab[1]]);
  const s = useBrowser.getState();
  const w = s.windows[windowId];
  const active = w?.activeTabIds[w.profileId];
  const shown = tabId ?? active;
  const onScreen = !!shown && (shown === active || !!splitTabIdsOf(splitOf(s, active))?.includes(shown));
  const live = (onScreen && webviews.get(shown)?.capturePicture(0.35).catch(() => null)) || Promise.resolve(null);
  void live.then((page) => {
    if (tabDragState()?.session !== session) return;
    if (page) return dragPreview.page(page.data, page.frame);
    const tab = shown ? useBrowser.getState().tabs[shown] : undefined;
    if (!shown || (onScreen && !tab?.url)) return;
    const last = lastPicture(shown);
    if (last) return dragPreview.page(last.data, last.frame);
    if (tab) dragPreview.placeholder(tabTitle(tab), tab.favicon);
  });
}

export function setDropTarget(target: DropTarget | null) {
  const d = tabDragState();
  if (!d || (d.target?.tabId === target?.tabId && d.target?.side === target?.side)) return;
  useTabDrag.setState({ target });
}

let resolveTarget: ((x: number, y: number, current: DropTarget | null, outside: boolean) => DropTarget | null) | null = null;
export function setTargetResolver(resolver: typeof resolveTarget) {
  resolveTarget = resolver;
}

export function setOnPage(onPage: boolean) {
  const d = tabDragState();
  if (!d || d.onPage === onPage) return;
  useTabDrag.setState({ onPage });
  syncPreview();
}

export function endTabDrag(): boolean {
  const drag = tabDragState();
  if (!drag) {
    useTabDrag.setState(IDLE, true);
    if (previewShown) dragPreview.end();
    return false;
  }
  const { tabId, tabIds, windowId, outside, overWindow, overPoint, session } = drag;
  const [x, y] = session.pointer;
  const resolveInsert = overWindow && overPoint ? insertResolvers.get(overWindow) : undefined;
  const insertBefore = resolveInsert && overPoint ? resolveInsert(overPoint) : drag.insert?.windowId === overWindow ? drag.insert?.beforeId : undefined;
  const target = resolveTarget ? resolveTarget(x, y, drag.target, outside) : drag.target;
  const onPage = !outside && !!(drag.lifted ?? drag.onPage);
  useTabDrag.setState(IDLE, true);
  const shown = previewShown;
  if (!outside && dropTabsOnBar(tabIds, windowId, x, y)) {
    if (shown) dragPreview.end();
    return true;
  }
  if (target && tabId) {
    dragPreview.end();
    dropTabIntoSplit(tabId, target.tabId, target.side);
    return true;
  }
  if (!(outside || onPage)) {
    if (shown) dragPreview.end();
    return false;
  }
  const asked: { frame: [number, number, number, number] | null } = { frame: null };
  const moved = dropTabsOutside(tabIds, windowId, x, y, (frame) => (asked.frame = frame), session.liveFrame);
  dragPreview.end(asked.frame ? moved : null, asked.frame);
  if (moved && moved === overWindow && insertBefore !== undefined) useBrowser.getState().placeTabs(tabIds, { pinned: false, beforeId: insertBefore });
  if (moved) focus(moved);
  return true;
}

export function cancelTabDrag() {
  useTabDrag.setState(IDLE, true);
  if (previewShown) dragPreview.cancel();
  previewShown = false;
}

const ownedExternal = (windowId: string, token: number) => {
  const d = useTabDrag.getState();
  return d.phase === "external" && d.owner.windowId === windowId && d.owner.token === token;
};

export function beginExternalDrag(windowId: string, point: [number, number], token: number) {
  if (useTabDrag.getState().phase === "tab") return;
  useTabDrag.setState({ phase: "external", owner: { windowId, token }, overWindow: windowId, overPoint: point, insert: null }, true);
}

export function moveExternalDrag(windowId: string, point: [number, number], token: number) {
  if (ownedExternal(windowId, token)) useTabDrag.setState({ overPoint: point });
}

export function endExternalDrag(windowId: string, point: [number, number] | null, token: number): string | null | undefined {
  if (!ownedExternal(windowId, token)) return undefined;
  const resolve = point ? insertResolvers.get(windowId) : undefined;
  const beforeId = resolve && point ? resolve(point) : undefined;
  useTabDrag.setState(IDLE, true);
  return beforeId;
}
