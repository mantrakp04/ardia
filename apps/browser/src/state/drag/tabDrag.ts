import { dragPreview, windowFrame, type DragPreviewShape } from "../../platform/windows";
import { hapticTick } from "../../platform/haptics";
import { create } from "zustand";
import { focus } from "../browser/actions";
import { lastPicture, startTabPictures } from "../tabs/tabPictures";
import { webviews } from "../../platform/webviews";
import { useBrowser } from "../browser/store";
import type { Frame } from "../browser/types";
import { splitOf, type SplitSide } from "../splits/splits";
import { dropTabIntoSplit } from "../splits/actions";
import { dropTabsOutside, screenPoint, windowUnder } from "./windowDrop";

export type DropTarget = { tabId: string; side: SplitSide };

type TabDrag = {
  tabId: string | null;
  tabIds: string[];
  windowId: string | null;
  x: number;
  y: number;
  lifted: boolean | null;
  onPage: boolean;
  target: DropTarget | null;
  outside: boolean;
  overWindow: string | null;
  overPoint: [number, number] | null;
  insert: { windowId: string; beforeId: string | null } | null;
};

export const useTabDrag = create<TabDrag>()(() => ({
  tabId: null,
  tabIds: [],
  windowId: null,
  x: 0,
  y: 0,
  lifted: null,
  onPage: false,
  target: null,
  outside: false,
  overWindow: null,
  overPoint: null,
  insert: null,
}));

if (__DEV__) (globalThis as { acTabDrag?: typeof useTabDrag }).acTabDrag = useTabDrag;

startTabPictures();

let dragSeq = 0;
let liveFrame: Frame | null = null;
let pointer: [number, number] = [-1, -1];
type Picture = { chip: () => [number, number, number, number]; grab: [number, number] };
let picture: Picture | null = null;
let sentShape: DragPreviewShape = "hidden";
let begun = false;

export const tabDragging = () => useTabDrag.getState().tabIds.length > 0;

export const tabDragOutside = () => useTabDrag.getState().outside;

export function beginTabDrag(tabId: string | null, tabIds: string[] = tabId ? [tabId] : []): number {
  if (begun) dragPreview.cancel();
  begun = false;
  picture = null;
  sentShape = "hidden";
  pointer = [-1, -1];
  const windowId = useBrowser.getState().tabs[tabIds[0] ?? ""]?.windowId ?? null;
  useTabDrag.setState({ ...IDLE, tabId, tabIds, windowId, x: -1, y: -1 });
  const seq = ++dragSeq;
  liveFrame = null;
  if (windowId)
    void windowFrame(windowId)
      .then((frame) => {
        if (seq === dragSeq) liveFrame = frame;
      })
      .catch(() => {});
  return seq;
}

export function updateTabDrag(x: number, y: number, lifted: boolean | null = null) {
  const drag = useTabDrag.getState();
  if (!drag.tabIds.length || !drag.windowId) return;
  const s = useBrowser.getState();
  const { outside, overWindow } = windowUnder(s, drag.windowId, x, y, liveFrame);
  if (overWindow && overWindow !== drag.overWindow && s.settings.tabReorderHaptics) hapticTick();
  const screen = overWindow ? screenPoint(s, drag.windowId, x, y, liveFrame) : null;
  const over = overWindow ? s.windows[overWindow]?.frame : null;
  const overPoint: [number, number] | null = screen && over ? [screen[0] - over[0], over[1] + over[3] - screen[1]] : null;
  const insert = drag.insert?.windowId === overWindow ? drag.insert : null;
  pointer = [x, y];
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
  const { overWindow, insert } = useTabDrag.getState();
  const next = overWindow === windowId && beforeId !== undefined ? { windowId, beforeId } : null;
  if (insert?.windowId === next?.windowId && insert?.beforeId === next?.beforeId) return;
  if (!next && insert?.windowId !== windowId) return;
  useTabDrag.setState({ insert: next });
  syncPreview();
}

function previewShape(d: TabDrag): DragPreviewShape {
  if (!d.tabIds.length) return "hidden";
  if (d.outside) return d.overWindow && d.insert?.windowId === d.overWindow ? "pill" : "card";
  return (d.lifted ?? d.onPage) ? "card" : "hidden";
}

function syncPreview() {
  const d = useTabDrag.getState();
  if (!d.windowId) return;
  const shape = previewShape(d);
  if (shape === "hidden" && sentShape === "hidden") return;
  if (shape !== "hidden" && picture) takePicture(picture, d.windowId);
  sentShape = shape;
  dragPreview.update(shape, pointer);
}

export function setDragPicture(drag: number, chip: [number, number, number, number] | (() => [number, number, number, number]), grab: [number, number]) {
  const { windowId, tabIds } = useTabDrag.getState();
  if (drag !== dragSeq || !windowId || !tabIds.length) return;
  const rect = typeof chip === "function" ? chip() : chip;
  picture = { chip: typeof chip === "function" ? chip : () => chip, grab: [grab[0] - rect[0], grab[1] - rect[1]] };
  syncPreview();
}

function takePicture({ chip, grab }: Picture, windowId: string) {
  picture = null;
  begun = true;
  const drag = dragSeq;
  const { tabId } = useTabDrag.getState();
  const rect = chip();
  dragPreview.begin(windowId, rect, [rect[0] + grab[0], rect[1] + grab[1]]);
  const s = useBrowser.getState();
  const w = s.windows[windowId];
  const active = w?.activeTabIds[w.profileId];
  const shown = tabId ?? active;
  const onScreen = !!shown && (shown === active || !!splitOf(s, active)?.tabIds.includes(shown));
  const live = (onScreen && webviews.get(shown)?.capturePicture(0.35).catch(() => null)) || Promise.resolve(null);
  void live.then((page) => {
    if (drag !== dragSeq || !useTabDrag.getState().tabIds.length) return;
    if (page) return dragPreview.page(page.data, page.frame);
    const tab = shown ? useBrowser.getState().tabs[shown] : undefined;
    if (!shown || (onScreen && !tab?.url)) return;
    const last = lastPicture(shown);
    if (last) return dragPreview.page(last.data, last.frame);
    if (tab) dragPreview.placeholder(tab.customTitle || tab.title || tab.url || "New Tab", tab.favicon);
  });
}

export function setDropTarget(target: DropTarget | null) {
  const current = useTabDrag.getState().target;
  if (current?.tabId === target?.tabId && current?.side === target?.side) return;
  useTabDrag.setState({ target });
}

let resolveTarget: ((x: number, y: number, current: DropTarget | null, outside: boolean) => DropTarget | null) | null = null;
export function setTargetResolver(resolver: typeof resolveTarget) {
  resolveTarget = resolver;
}

export function setOnPage(onPage: boolean) {
  if (useTabDrag.getState().onPage === onPage) return;
  useTabDrag.setState({ onPage });
  syncPreview();
}

const IDLE = {
  tabId: null,
  tabIds: [],
  windowId: null,
  lifted: null,
  onPage: false,
  target: null,
  outside: false,
  overWindow: null,
  overPoint: null,
  insert: null,
} as const;

export function endTabDrag(): boolean {
  const drag = useTabDrag.getState();
  const { tabId, tabIds, windowId, outside, overWindow, overPoint } = drag;
  const [x, y] = pointer;
  const resolveInsert = overWindow && overPoint ? insertResolvers.get(overWindow) : undefined;
  const insertBefore = resolveInsert ? resolveInsert(overPoint!) : drag.insert?.windowId === overWindow ? drag.insert?.beforeId : undefined;
  const target = resolveTarget ? resolveTarget(x, y, drag.target, outside) : drag.target;
  const onPage = !outside && !!(drag.lifted ?? drag.onPage);
  useTabDrag.setState({ ...IDLE, tabIds: [] });
  dragSeq++;
  picture = null;
  const shown = begun;
  sentShape = "hidden";
  if (target && tabId) {
    dragPreview.end();
    dropTabIntoSplit(tabId, target.tabId, target.side);
    return true;
  }
  if (!(outside || onPage) || !windowId || !tabIds.length) {
    if (shown) dragPreview.end();
    return false;
  }
  const asked: { frame: [number, number, number, number] | null } = { frame: null };
  const moved = dropTabsOutside(tabIds, windowId, x, y, (frame) => (asked.frame = frame), liveFrame);
  dragPreview.end(asked.frame ? moved : null, asked.frame);
  if (moved && moved === overWindow && insertBefore !== undefined) useBrowser.getState().placeTabs(tabIds, { pinned: false, beforeId: insertBefore });
  if (moved) focus(moved);
  return true;
}

export function cancelTabDrag() {
  useTabDrag.setState({ ...IDLE, tabIds: [] });
  dragSeq++;
  picture = null;
  if (begun) dragPreview.cancel();
  begun = false;
  sentShape = "hidden";
}

const EXTERNAL_DRAG = "external";
let externalOwner: { windowId: string; token: number } | null = null;
const ownsExternal = (windowId: string, token: number) =>
  useTabDrag.getState().windowId === EXTERNAL_DRAG && externalOwner?.windowId === windowId && externalOwner.token === token;

export function beginExternalDrag(windowId: string, point: [number, number], token: number) {
  const drag = useTabDrag.getState();
  if (drag.tabIds.length && drag.windowId !== EXTERNAL_DRAG) return;
  externalOwner = { windowId, token };
  useTabDrag.setState({ ...IDLE, tabIds: [EXTERNAL_DRAG], windowId: EXTERNAL_DRAG, overWindow: windowId, overPoint: point, x: -1, y: -1 });
}

export function moveExternalDrag(windowId: string, point: [number, number], token: number) {
  if (ownsExternal(windowId, token)) useTabDrag.setState({ overPoint: point });
}

export function endExternalDrag(windowId: string, point: [number, number] | null, token: number): string | null | undefined {
  if (!ownsExternal(windowId, token)) return undefined;
  const resolve = point ? insertResolvers.get(windowId) : undefined;
  const beforeId = resolve && point ? resolve(point) : undefined;
  externalOwner = null;
  useTabDrag.setState({ ...IDLE, tabIds: [] });
  return beforeId;
}
