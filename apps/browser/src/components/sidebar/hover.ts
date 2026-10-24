import { useContext, useEffect, useReducer, useRef, useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import { markHoverProps } from "../../lib/hoverShift";
import { useBrowser } from "../../store/browser";
import { PageProfileContext } from "../../store/hooks";
import { cardReach, type Point, type Rect } from "./hoverAim";
import { measureRow, setSidebarUi, sidebarUi, type Target } from "./state";

const SHOW_DELAY_MS = 500;
const HIDE_DELAY_MS = 160;
const AIM_MS = 200;
let showTimer: ReturnType<typeof setTimeout> | undefined;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let aimTimer: ReturnType<typeof setTimeout> | undefined;
let suppressed = false;
let ticket = 0;
let underPointer: string | null = null;
let owner: string | null = null;
let ownerWindow: string | null = null;

type PointerEvent = { nativeEvent?: { screenX?: unknown; screenY?: unknown } } | undefined;
type Waiting = { windowId: string; target: Target | null; arrive: () => void };
const contentHeights = new Map<string, number>();
let cardFrame: Rect | null = null;
let onCard = false;
let exitPoint: Point | null = null;
let waiting: Waiting | null = null;

export const setHoverSpace = (windowId: string, height: number) => void contentHeights.set(windowId, height);

function pointerIn(windowId: string, event: PointerEvent): Point | null {
  const x = event?.nativeEvent?.screenX;
  const y = event?.nativeEvent?.screenY;
  const height = contentHeights.get(windowId);
  if (typeof x !== "number" || typeof y !== "number" || height === undefined) return null;
  return { x, y: height - y };
}

function hideCard() {
  onCard = false;
  exitPoint = null;
  waiting = null;
  clearTimeout(aimTimer);
  setSidebarUi({ hover: null });
}

function cardHeldFor(windowId: string, target: Target | null, event: PointerEvent) {
  const hover = sidebarUi().hover;
  if (!hover || hover.windowId !== windowId || !cardFrame || (target && hover.id === target.id)) return null;
  const at = pointerIn(windowId, event);
  if (!at) return null;
  const reach = cardReach(cardFrame, exitPoint, at);
  return reach === "away" ? null : reach;
}

function arrive(next: Waiting | null) {
  if (!next) return hoverLeave();
  next.arrive();
}

function holdFor(next: Waiting) {
  waiting = next;
  clearTimeout(hideTimer);
  clearTimeout(aimTimer);
  aimTimer = setTimeout(() => {
    if (onCard) return;
    const pending = waiting;
    waiting = null;
    arrive(pending);
  }, AIM_MS);
}

export const cardHoverProps = {
  onMouseEnter: () => {
    onCard = true;
    clearTimeout(aimTimer);
    keepHover();
  },
  onMouseLeave: () => {
    onCard = false;
    const pending = waiting;
    waiting = null;
    arrive(pending);
  },
  onLayout: (e: LayoutChangeEvent) => {
    cardFrame = e.nativeEvent.layout;
  },
};

export const pointerOnRow = (id: string) => underPointer === id;
export const pointerOnCard = () => onCard;

const panelOpen = (windowId: string) => !!useBrowser.getState().windowUi[windowId]?.panel?.open;
const covered = new Set<string>();
const pointedRows = new Map<string, Set<() => void>>();

export function setRowsCovered(windowId: string, on: boolean) {
  if (on === covered.has(windowId)) return;
  if (on) covered.add(windowId);
  else covered.delete(windowId);
  for (const refresh of pointedRows.get(windowId) ?? []) refresh();
}

function pointed(windowId: string, refresh: () => void, on: boolean) {
  let rows = pointedRows.get(windowId);
  if (on) {
    if (!rows) pointedRows.set(windowId, (rows = new Set()));
    rows.add(refresh);
  } else if (rows?.delete(refresh) && !rows.size) pointedRows.delete(windowId);
}

export function suppressHover(value: boolean) {
  suppressed = value;
  if (value) dismissHover();
}

async function show(windowId: string, target: Target, mine: number) {
  const anchor = await measureRow(windowId, target.id);
  if (mine !== ticket || suppressed || !anchor || panelOpen(windowId) || sidebarUi().iconPicker || sidebarUi().renaming) return;
  if (onCard && sidebarUi().hover) return;
  exitPoint = null;
  setSidebarUi({ hover: { windowId, ...target, anchor } });
}

export function hoverEnter(windowId: string, target: Target) {
  if (suppressed || panelOpen(windowId)) return;
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  clearTimeout(aimTimer);
  waiting = null;
  const current = sidebarUi().hover;
  owner = target.id;
  ownerWindow = windowId;
  if (current?.id === target.id) return;
  const mine = ++ticket;
  if (current) void show(windowId, target, mine);
  else showTimer = setTimeout(() => void show(windowId, target, mine), SHOW_DELAY_MS);
}

export function hoverLeave(from?: unknown) {
  if (typeof from === "string" && from !== owner) return;
  owner = null;
  ticket++;
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hideCard, HIDE_DELAY_MS);
}

export const keepHover = () => {
  clearTimeout(hideTimer);
  clearTimeout(aimTimer);
};

export function dismissHover() {
  owner = null;
  ownerWindow = null;
  ticket++;
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  if (sidebarUi().hover) hideCard();
}

export function dismissHoverIn(windowId: string) {
  if (ownerWindow === windowId || sidebarUi().hover?.windowId === windowId) dismissHover();
}

function releaseAnchor(windowId: string, id: string) {
  if (underPointer === id) underPointer = null;
  if (owner === id && ownerWindow === windowId) return dismissHover();
  const hover = sidebarUi().hover;
  if (hover?.windowId === windowId && hover.id === id) hideCard();
}

export function useRowHover(windowId: string, target: Target | null) {
  const [hovered, setHovered] = useState(false);
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const page = useContext(PageProfileContext);
  const latest = useRef({ windowId, target, page });
  latest.current = { windowId, target, page };
  const onCurrentPage = () => {
    const { windowId, page } = latest.current;
    return !page || useBrowser.getState().windows[windowId]?.profileId === page;
  };
  const [hoverProps] = useState(() =>
    markHoverProps({
      onMouseEnter: (event?: PointerEvent) => {
        if (!onCurrentPage()) return;
        const { windowId, target } = latest.current;
        pointed(windowId, refresh, true);
        const enter = () => {
          setHovered(true);
          underPointer = target?.id ?? null;
          if (target) hoverEnter(windowId, target);
        };
        const held = cardHeldFor(windowId, target, event);
        if (!held) return enter();
        if (held === "aiming") setHovered(true);
        holdFor({ windowId, target, arrive: enter });
      },
      onMouseLeave: (event?: PointerEvent) => {
        setHovered(false);
        const { windowId, target } = latest.current;
        pointed(windowId, refresh, false);
        if (waiting && waiting.windowId === windowId && waiting.target?.id === target?.id) waiting = null;
        if (underPointer === target?.id) underPointer = null;
        const hover = sidebarUi().hover;
        if (target && hover?.windowId === windowId && hover.id === target.id) exitPoint = pointerIn(windowId, event);
        if (target && onCurrentPage()) hoverLeave(target.id);
      },
    }),
  );
  useEffect(
    () => () => {
      const { windowId, target } = latest.current;
      pointed(windowId, refresh, false);
      if (target) releaseAnchor(windowId, target.id);
    },
    [],
  );
  return { hovered: hovered && !covered.has(windowId), hoverProps };
}
