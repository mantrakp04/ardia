import { create } from "zustand";
import { useBrowser } from "../browser/store";
import { bookmarkProfileId } from "../browser/model";
import type { TabDrag } from "../drag/tabDrag";
import { addBookmark, moveBookmark } from "./actions";
import { addFolderToSidebar } from "./bookmarkGroups";
import { insertTarget, linkTitle, moveTarget, sameSpot, type DropSpot } from "./barDrop";
import { closeFolderMenus, closeSprungMenus, holdMenuPanel, panelKey, useFolderMenus } from "./folderMenus";
import { onAppEvent, setDragEscapeCapture } from "../drag/dragNative";
import { isWebPageUrl } from "../../lib/url";
import { isWithin } from "./bookmarks";

export type BarDragSource = { kind: "bookmark"; id: string; panel: string | null } | { kind: "tabs"; tabIds: string[] } | { kind: "links" };

export type ZoneHit = { spot: DropSpot | null; springOpen?: () => void };

export type DropZone = {
  windowId: string;
  depth: number;
  resolve(x: number, y: number, draggedId: string | null): ZoneHit | undefined;
};

type BarDrag = {
  windowId: string | null;
  source: BarDragSource | null;
  spot: DropSpot | null;
  x: number;
  y: number;
  grab: { x: number; y: number; width: number; height: number };
  sidebarEdge: number;
};

const IDLE: BarDrag = { windowId: null, source: null, spot: null, x: 0, y: 0, grab: { x: 0, y: 0, width: 0, height: 0 }, sidebarEdge: 0 };

export const useBarDrag = create<BarDrag>()(() => IDLE);

export const barDragging = () => !!useBarDrag.getState().source;

const SPRING_OPEN_MS = 550;
const LINK_LEAVE_MS = 300;

const zones = new Map<string, DropZone>();
let spring: { key: string; timer: ReturnType<typeof setTimeout> } | null = null;
let linkLeave: ReturnType<typeof setTimeout> | undefined;

export function registerDropZone(key: string, zone: DropZone) {
  zones.set(key, zone);
  return () => {
    if (zones.get(key) === zone) zones.delete(key);
  };
}

function hitAt(windowId: string, x: number, y: number, draggedId: string | null): ZoneHit | null {
  let best: { depth: number; hit: ZoneHit } | null = null;
  for (const zone of zones.values()) {
    if (zone.windowId !== windowId) continue;
    const hit = zone.resolve(x, y, draggedId);
    if (hit && (!best || zone.depth > best.depth)) best = { depth: zone.depth, hit };
  }
  if (!best) return null;
  const { spot } = best.hit;
  if (!spot || !draggedId) return best.hit;
  const b = useBrowser.getState().bookmarks;
  const parentId = "into" in spot ? spot.into : spot.parentId;
  return isWithin(b, parentId, [draggedId]) ? { spot: null } : best.hit;
}

function armSpring(hit: ZoneHit | null) {
  const key = hit?.spot && "into" in hit.spot && hit.springOpen ? hit.spot.into : null;
  if (key === spring?.key) return;
  clearTimeout(spring?.timer);
  spring = key ? { key, timer: setTimeout(() => ((spring = null), hit!.springOpen!()), SPRING_OPEN_MS) } : null;
}

function track(windowId: string, x: number, y: number, draggedId: string | null): DropSpot | null {
  const hit = hitAt(windowId, x, y, draggedId);
  armSpring(hit);
  const spot = hit?.spot ?? null;
  const s = useBarDrag.getState();
  useBarDrag.setState({ x, y, spot: sameSpot(s.spot, spot) ? s.spot : spot });
  return spot;
}

function finish() {
  armSpring(null);
  useBarDrag.setState(IDLE);
}

export function beginBookmarkDrag(options: {
  windowId: string;
  id: string;
  panel: string | null;
  x: number;
  y: number;
  grab: BarDrag["grab"];
  sidebarEdge: number;
}) {
  const { windowId, id, panel, x, y, grab, sidebarEdge } = options;
  useBarDrag.setState({ ...IDLE, windowId, source: { kind: "bookmark", id, panel }, x, y, grab, sidebarEdge });
  holdMenuPanel(panel);
  track(windowId, x, y, id);
}

export function moveBookmarkDrag(x: number, y: number) {
  const { windowId, source } = useBarDrag.getState();
  if (!windowId || source?.kind !== "bookmark") return;
  track(windowId, x, y, source.id);
}

export function endBookmarkDrag(commit: boolean) {
  const { windowId, source, x, y, sidebarEdge } = useBarDrag.getState();
  if (!windowId || source?.kind !== "bookmark") return;
  const spot = commit ? track(windowId, x, y, source.id) : null;
  const b = useBrowser.getState().bookmarks;
  const node = b.nodes[source.id];
  const target = spot ? moveTarget(b, source.id, spot) : null;
  if (target) moveBookmark(source.id, target.parentId, target.index);
  const toSidebar = commit && !spot && node?.kind === "folder" && x < sidebarEdge;
  finish();
  holdMenuPanel(null);
  if (toSidebar) addFolderToSidebar(source.id, windowId);
  const stays = !!spot && "slot" in spot && !!source.panel && panelKey(spot.parentId) === source.panel;
  if (!stays && (source.panel || spot)) closeFolderMenus();
}

function bookmarkLinks(windowId: string, spot: DropSpot, links: { url: string; title: string; favicon?: string | null }[]) {
  const s = useBrowser.getState();
  const target = insertTarget(s.bookmarks, spot);
  if (!target || !links.length) return false;
  const profileId = bookmarkProfileId(s, s.windows[windowId]);
  links.forEach((link, i) => addBookmark({ profileId, ...link, parentId: target.parentId, index: target.index + i }));
  return true;
}

export function linkDragAt(windowId: string, x: number, y: number) {
  clearTimeout(linkLeave);
  const s = useBarDrag.getState();
  if (s.source && s.source.kind !== "links") return;
  if (!s.source) useBarDrag.setState({ ...IDLE, windowId, source: { kind: "links" } });
  track(windowId, x, y, null);
}

export function linkDragLeft() {
  clearTimeout(linkLeave);
  linkLeave = setTimeout(() => {
    if (useBarDrag.getState().source?.kind !== "links") return;
    finish();
    closeSprungMenus();
  }, LINK_LEAVE_MS);
}

export function dropLinksAt(windowId: string, x: number, y: number, links: { url: string; text?: string | null }[]): boolean {
  clearTimeout(linkLeave);
  const hit = hitAt(windowId, x, y, null);
  finish();
  closeSprungMenus();
  const usable = links.filter((l) => isWebPageUrl(l.url));
  return !!hit?.spot && bookmarkLinks(windowId, hit.spot, usable.map((l) => ({ url: l.url, title: linkTitle(l.url, l.text) })));
}

export function dropTabsOnBar(tabIds: string[], windowId: string, x: number, y: number): boolean {
  const hit = hitAt(windowId, x, y, null);
  finish();
  if (!hit?.spot) return false;
  const tabs = useBrowser.getState().tabs;
  const links = tabIds
    .map((id) => tabs[id])
    .filter((t) => !!t && isWebPageUrl(t.url))
    .map((t) => ({ url: t!.url, title: t!.customTitle || t!.title || linkTitle(t!.url, null), favicon: t!.favicon }));
  const done = bookmarkLinks(windowId, hit.spot, links);
  closeSprungMenus();
  return done;
}

export function followTabDragOnBar(d: TabDrag) {
  const s = useBarDrag.getState();
  if (d.phase !== "tab" || d.outside || d.x < 0) {
    if (s.source?.kind === "tabs") {
      finish();
      closeSprungMenus();
    }
    return;
  }
  if (s.source && s.source.kind !== "tabs") return;
  if (!s.source || s.windowId !== d.windowId) useBarDrag.setState({ ...IDLE, windowId: d.windowId, source: { kind: "tabs", tabIds: d.tabIds } });
  track(d.windowId, d.x, d.y, null);
}

let escapeWatchers = 0;
let stopEscape: (() => void) | null = null;

export function watchBookmarkEscape() {
  if (escapeWatchers++ === 0) {
    let capturing = false;
    const sync = () => {
      const want = useFolderMenus.getState().panels.length > 0 || useBarDrag.getState().source?.kind === "bookmark";
      if (want === capturing) return;
      capturing = want;
      setDragEscapeCapture(want);
    };
    const menus = useFolderMenus.subscribe(sync);
    const drags = useBarDrag.subscribe(sync);
    const keys = onAppEvent((e) => {
      if (e.type !== "dragEscape") return;
      if (useBarDrag.getState().source?.kind === "bookmark") endBookmarkDrag(false);
      else closeFolderMenus();
    });
    stopEscape = () => {
      menus();
      drags();
      keys.remove();
      if (capturing) setDragEscapeCapture(false);
    };
  }
  return () => {
    if (--escapeWatchers > 0) return;
    stopEscape?.();
    stopEscape = null;
  };
}

if (__DEV__)
  (globalThis as { acBarDrag?: unknown }).acBarDrag = {
    store: useBarDrag,
    begin: beginBookmarkDrag,
    move: moveBookmarkDrag,
    end: endBookmarkDrag,
    linkAt: linkDragAt,
    dropLinks: dropLinksAt,
    hitAt,
  };
