import { hoverHeld } from "../app/transientUi";
import { cardReach, pointInRect, type Point, type Rect } from "./hoverAim";
import { measureRow, setSidebarUi, sidebarUi, type Target } from "./sidebarUi";

export type HoverPointerEvent = { nativeEvent?: { screenX?: unknown; screenY?: unknown } } | undefined;
type Row = { windowId: string; id: string };
type Waiting = { windowId: string; target: Target | null; arrive: () => void };
type Card = { frame: Rect | null; pointerOn: boolean; exit: Point | null; waiting: Waiting | null; held: boolean };

const DELAY_MS = { show: 500, hide: 160, aim: 200 };
const timers: Record<keyof typeof DELAY_MS, ReturnType<typeof setTimeout> | undefined> = { show: undefined, hide: undefined, aim: undefined };
const card: Card = { frame: null, pointerOn: false, exit: null, waiting: null, held: false };
const contentHeights = new Map<string, number>();
let owner: Row | null = null;
let underPointer: string | null = null;
let suppressed = false;
let ticket = 0;

const stop = (...kinds: (keyof typeof timers)[]) => kinds.forEach((kind) => clearTimeout(timers[kind]));
const start = (kind: keyof typeof timers, run: () => void) => void (timers[kind] = setTimeout(run, DELAY_MS[kind]));
const isShown = (windowId: string, id: string | undefined) => {
  const hover = sidebarUi().hover;
  return !!hover && hover.windowId === windowId && hover.id === id;
};

export const setHoverSpace = (windowId: string, height: number) => void contentHeights.set(windowId, height);

function pointerIn(windowId: string, event: HoverPointerEvent): Point | null {
  const x = event?.nativeEvent?.screenX;
  const y = event?.nativeEvent?.screenY;
  const height = contentHeights.get(windowId);
  if (typeof x !== "number" || typeof y !== "number" || height === undefined) return null;
  return { x, y: height - y };
}

function hideCard() {
  Object.assign(card, { held: false, pointerOn: false, exit: null, waiting: null });
  stop("aim");
  setSidebarUi({ hover: null });
}

function cardHeldFor(windowId: string, target: Target | null, event: HoverPointerEvent) {
  const hover = sidebarUi().hover;
  if (!hover || hover.windowId !== windowId || !card.frame || (target && hover.id === target.id)) return null;
  const at = pointerIn(windowId, event);
  if (!at) return null;
  const reach = cardReach(card.frame, card.exit, at);
  return reach === "away" ? null : reach;
}

function arrive(next: Waiting | null) {
  if (!next) return hoverLeave();
  next.arrive();
}

function takeWaiting() {
  const next = card.waiting;
  card.waiting = null;
  return next;
}

function holdFor(next: Waiting) {
  card.waiting = next;
  stop("hide", "aim");
  start("aim", () => {
    if (!card.pointerOn) arrive(takeWaiting());
  });
}

const forgetWaiting = (windowId: string, id: string | undefined) => {
  if (card.waiting?.windowId === windowId && card.waiting.target?.id === id) card.waiting = null;
};

export function cardEntered() {
  if (!sidebarUi().hover) return;
  card.pointerOn = true;
  stop("aim");
  keepHover();
}

export function cardLeft() {
  card.pointerOn = false;
  arrive(takeWaiting());
}

export const cardLaidOut = (frame: Rect) => void (card.frame = frame);

export const pointerOnRow = (id: string) => underPointer === id;
export const pointerOnCard = () => card.pointerOn;

const covered = new Set<string>();
const pointedRows = new Map<string, Set<() => void>>();

export function setRowsCovered(windowId: string, on: boolean) {
  if (on === covered.has(windowId)) return;
  if (on) covered.add(windowId);
  else covered.delete(windowId);
  for (const refresh of pointedRows.get(windowId) ?? []) refresh();
}

export const rowsCovered = (windowId: string) => covered.has(windowId);

export function watchCovered(windowId: string, refresh: () => void, on: boolean) {
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
  if (mine !== ticket || suppressed || !anchor || hoverHeld(windowId)) return;
  if (card.pointerOn && sidebarUi().hover) return;
  card.exit = null;
  setSidebarUi({ hover: { windowId, ...target, anchor } });
}

export function hoverEnter(windowId: string, target: Target) {
  if (suppressed || hoverHeld(windowId)) return;
  stop("show", "hide", "aim");
  card.waiting = null;
  const current = sidebarUi().hover;
  owner = { windowId, id: target.id };
  if (current?.id === target.id) return;
  const mine = ++ticket;
  if (current) void show(windowId, target, mine);
  else start("show", () => void show(windowId, target, mine));
}

export function hoverLeave(from?: unknown) {
  if (card.held || (typeof from === "string" && from !== owner?.id)) return;
  owner = null;
  ticket++;
  stop("show", "hide");
  start("hide", hideCard);
}

export const keepHover = () => stop("hide", "aim");

export function holdHover(on: boolean) {
  if (on === card.held) return;
  card.held = on;
  if (on) return keepHover();
  const hover = sidebarUi().hover;
  if (!hover || card.pointerOn) return;
  if (underPointer !== hover.id) return hoverLeave();
  owner = { windowId: hover.windowId, id: hover.id };
}

export function dismissHover() {
  card.held = false;
  owner = null;
  ticket++;
  stop("show", "hide");
  if (sidebarUi().hover) hideCard();
}

export function dismissHoverIn(windowId: string) {
  if (owner?.windowId === windowId || sidebarUi().hover?.windowId === windowId) dismissHover();
}

export function releaseAnchor(windowId: string, id: string) {
  if (underPointer === id) underPointer = null;
  forgetWaiting(windowId, id);
  if (owner?.id === id && owner.windowId === windowId) return dismissHover();
  if (isShown(windowId, id)) hideCard();
}

export function rowEntered(windowId: string, target: Target | null, event: HoverPointerEvent, enter: () => void, aiming: () => void) {
  const at = pointerIn(windowId, event);
  if (card.pointerOn && at && card.frame && !pointInRect(card.frame, at)) card.pointerOn = false;
  const reach = cardHeldFor(windowId, target, event);
  if (!reach) return enter();
  if (reach === "aiming") aiming();
  holdFor({ windowId, target, arrive: enter });
}

export function rowShown(windowId: string, target: Target | null) {
  underPointer = target?.id ?? null;
  if (target) hoverEnter(windowId, target);
}

export function rowLeft(windowId: string, target: Target | null, event: HoverPointerEvent, onPage: boolean) {
  forgetWaiting(windowId, target?.id);
  if (underPointer === target?.id) underPointer = null;
  if (target && isShown(windowId, target.id)) card.exit = pointerIn(windowId, event);
  if (target && onPage) hoverLeave(target.id);
}

const pointedGroups = new Set<string>();

export const pointerOnGroup = (groupId: string) => pointedGroups.has(groupId);

export function setGroupPointed(groupId: string, on: boolean) {
  if (on) pointedGroups.add(groupId);
  else pointedGroups.delete(groupId);
}
