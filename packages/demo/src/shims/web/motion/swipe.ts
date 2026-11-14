import type { SwipeEvent, SwipeStep } from "@ardia-real/ardiacore";
import type { Pager, PagerArea, PagerInput } from "./pager";

const START_DISTANCE = 4;
const START_DOMINANCE = 1.5;
const CANCEL_DOMINANCE = 2;
const SAMPLES = 6;
const VELOCITY_WINDOW = 0.1;
const GESTURE_GAP = 0.06;
const MIN_RELEASE_GAP = 0.025;
const CADENCE_SLACK = 2.5;
const MOMENTUM_START_WAIT = 0.1;
const MOMENTUM_RUN = 3;
const MOMENTUM_DROP = 0.85;
const MOMENTUM_STEP = 0.985;
const MOMENTUM_FLOOR = 0.45;
const RESUME_JUMP = 1.35;

export type SwipeTarget = {
  node: () => HTMLElement | null;
  canSwipeBack: () => boolean;
  canSwipeForward: () => boolean;
  tracksUnavailableDirections: () => boolean;
  allowsVerticalMotion: () => boolean;
  isPager: () => boolean;
  pager: () => { pager: Pager; area: PagerArea } | null;
  onSwipe: (event: SwipeEvent) => void;
};

type State = "idle" | "pending" | "tracking" | "ignored";

type Gesture = {
  state: State;
  target: SwipeTarget | null;
  hit: Element | null;
  dx: number;
  dy: number;
  direction: number;
  available: boolean;
  times: number[];
  deltas: number[];
  time: number;
};

const targets = new Set<SwipeTarget>();
let gesture: Gesture = blank();
let prepared: SwipeTarget | null = null;
let lastEventAt = -Infinity;
let gapTimer: ReturnType<typeof setTimeout> | undefined;
let magnitudes: { t: number; m: number }[] = [];
let swallowing = false;
let lastMagnitude = 0;

function blank(): Gesture {
  return { state: "idle", target: null, hit: null, dx: 0, dy: 0, direction: 0, available: false, times: [], deltas: [], time: 0 };
}

export function addSwipeTarget(target: SwipeTarget) {
  targets.add(target);
  install();
  return () => {
    targets.delete(target);
    if (gesture.target === target) gesture = blank();
    if (prepared === target) prepared = null;
  };
}

const isPager = (t: SwipeTarget) => t.isPager();
const hasNativePager = (t: SwipeTarget) => t.isPager() && !!t.pager();

function visible(node: HTMLElement) {
  if (!node.isConnected || !node.getClientRects().length) return false;
  for (let el: HTMLElement | null = node; el; el = el.parentElement) {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
  }
  return true;
}

function targetAt(x: number, y: number, hit: Element | null): SwipeTarget | null {
  if (!hit) return null;
  let best: SwipeTarget | null = null;
  let bestContainer: HTMLElement | null = null;
  for (const target of targets) {
    const node = target.node();
    const container = node?.parentElement;
    if (!node || !container || !visible(node) || !container.contains(hit)) continue;
    const r = node.getBoundingClientRect();
    if (x < r.left || x >= r.right || y < r.top || y >= r.bottom) continue;
    if (!best || (bestContainer && bestContainer !== container && bestContainer.contains(container))) {
      best = target;
      bestContainer = container;
    }
  }
  return best;
}

function contentScrolls(hit: Element | null, container: Element | null, direction: number) {
  for (let el = hit; el && el !== container; el = el.parentElement) {
    if (!(el instanceof HTMLElement)) continue;
    if (el.scrollWidth <= el.clientWidth + 0.5) continue;
    const overflow = getComputedStyle(el).overflowX;
    if (overflow !== "auto" && overflow !== "scroll") continue;
    if (direction > 0 ? el.scrollLeft > 0.5 : el.scrollLeft + el.clientWidth < el.scrollWidth - 0.5) return true;
  }
  return false;
}

function emit(phase: "began" | "changed" | "ended" | "cancelled", velocity: number) {
  const target = gesture.target;
  if (!target) return;
  const distance = gesture.dx * gesture.direction;
  const native = hasNativePager(target) ? target.pager() : null;
  if (native) {
    native.pager.input(native.area, phase as PagerInput, distance, gesture.direction, gesture.time);
    return;
  }
  target.onSwipe({
    phase,
    direction: gesture.direction > 0 ? "back" : "forward",
    distance,
    dy: gesture.dy,
    velocity: velocity * gesture.direction,
    available: gesture.available,
    width: target.node()?.getBoundingClientRect().width ?? 0,
  });
}

function pagerInput(target: SwipeTarget | null, input: PagerInput, timestamp: number) {
  const native = target && hasNativePager(target) ? target.pager() : null;
  native?.pager.input(native.area, input, 0, 0, timestamp);
}

function releasePrepared(timestamp: number) {
  const target = prepared;
  prepared = null;
  pagerInput(target, "abandon", timestamp);
}

function sample(time: number, dx: number) {
  gesture.times.push(time);
  gesture.deltas.push(dx);
  if (gesture.times.length > SAMPLES) {
    gesture.times.shift();
    gesture.deltas.shift();
  }
}

function releaseVelocity(at: number) {
  let sum = 0;
  let oldest = at;
  gesture.times.forEach((t, k) => {
    if (at - t > VELOCITY_WINDOW) return;
    sum += gesture.deltas[k]!;
    oldest = Math.min(oldest, t);
  });
  return at - oldest > 0.004 ? sum / (at - oldest) : 0;
}

function reject() {
  gesture.state = "ignored";
  releasePrepared(gesture.time);
  return false;
}

function shouldTrack() {
  const { dx, dy, target } = gesture;
  if (!target) return false;
  const verticalIntent = isPager(target) ? 3 * START_DISTANCE : START_DISTANCE;
  if (Math.abs(dy) >= verticalIntent && CANCEL_DOMINANCE * Math.abs(dx) < Math.abs(dy)) return reject();
  const below = hasNativePager(target) ? dx === 0 : Math.abs(dx) < START_DISTANCE;
  if (below || START_DOMINANCE * Math.abs(dx) < Math.abs(dy)) return false;
  const direction = dx > 0 ? 1 : -1;
  if (contentScrolls(gesture.hit, target.node()?.parentElement ?? null, direction)) return reject();
  const available = direction > 0 ? target.canSwipeBack() : target.canSwipeForward();
  if (!available && !target.tracksUnavailableDirections()) return reject();
  gesture.direction = direction;
  gesture.available = available;
  return true;
}

export function begin(x: number, y: number, hit: Element | null, timestamp: number) {
  if (gesture.state === "tracking") pagerInput(gesture.target, "abandon", timestamp);
  gesture = blank();
  const target = targetAt(x, y, hit);
  if (!target) {
    gesture.state = "ignored";
    releasePrepared(timestamp);
    return;
  }
  if (prepared !== target) releasePrepared(timestamp);
  gesture.state = "pending";
  gesture.target = target;
  gesture.hit = hit;
}

export function prepare(x: number, y: number, hit: Element | null, timestamp: number) {
  releasePrepared(timestamp);
  const target = targetAt(x, y, hit);
  if (!target || !hasNativePager(target)) return;
  prepared = target;
  pagerInput(target, "prepare", timestamp);
}

export function update(dx: number, dy: number, timestamp: number): boolean {
  if (gesture.state !== "pending" && gesture.state !== "tracking") return false;
  if (!gesture.target) {
    reject();
    return false;
  }
  gesture.dx += dx;
  gesture.dy += dy;
  gesture.time = timestamp;
  sample(timestamp, dx);
  if (gesture.state === "pending") {
    if (!shouldTrack()) return false;
    gesture.state = "tracking";
    if (prepared === gesture.target) prepared = null;
    emit("began", 0);
    return true;
  }
  if (!isPager(gesture.target) && !gesture.target.allowsVerticalMotion() && CANCEL_DOMINANCE * Math.abs(gesture.dx) < Math.abs(gesture.dy)) {
    emit("cancelled", 0);
    gesture.state = "ignored";
    return false;
  }
  emit("changed", releaseVelocity(timestamp));
  return true;
}

export function end(cancelled: boolean, timestamp: number) {
  const tracked = gesture.state === "tracking";
  if (!tracked) {
    if (gesture.state === "pending") gesture.state = "idle";
    releasePrepared(timestamp);
    return false;
  }
  emit(cancelled ? "cancelled" : "ended", releaseVelocity(timestamp));
  gesture.state = "idle";
  return true;
}

function wheelStep(target: SwipeTarget | null, hit: Element | null, dx: number) {
  if (!target || !isPager(target)) return false;
  const back = dx > 0;
  if (contentScrolls(hit, target.node()?.parentElement ?? null, back ? 1 : -1)) return false;
  target.onSwipe({
    phase: "wheel",
    direction: back ? "back" : "forward",
    distance: Math.abs(dx),
    dy: 0,
    velocity: 0,
    available: back ? target.canSwipeBack() : target.canSwipeForward(),
    width: target.node()?.getBoundingClientRect().width ?? 0,
  });
  return true;
}

function isPrecise(e: WheelEvent) {
  if (e.deltaMode !== 0) return false;
  const legacy = e as WheelEvent & { wheelDeltaX?: number; wheelDeltaY?: number };
  if (legacy.wheelDeltaX === undefined || legacy.wheelDeltaY === undefined) return true;
  const ratioX = e.deltaX ? Math.abs(legacy.wheelDeltaX / e.deltaX) : 3;
  const ratioY = e.deltaY ? Math.abs(legacy.wheelDeltaY / e.deltaY) : 3;
  const discrete = (legacy.wheelDeltaX !== 0 && legacy.wheelDeltaX % 120 === 0) || (legacy.wheelDeltaY !== 0 && legacy.wheelDeltaY % 120 === 0);
  return !discrete || (Math.abs(ratioX - 3) < 0.05 && Math.abs(ratioY - 3) < 0.05 && Math.abs(e.deltaX) + Math.abs(e.deltaY) < 120);
}

function looksLikeMomentum() {
  if (magnitudes.length < MOMENTUM_RUN + 1) return false;
  const run = magnitudes.slice(-(MOMENTUM_RUN + 1));
  for (let i = 1; i < run.length; i++) {
    const ratio = run[i]!.m / run[i - 1]!.m;
    if (!(ratio <= MOMENTUM_STEP && ratio >= MOMENTUM_FLOOR)) return false;
  }
  const peak = Math.max(...magnitudes.slice(-8).map((s) => s.m));
  return run.at(-1)!.m <= peak * MOMENTUM_DROP && peak >= 3;
}

function releaseGap() {
  if (magnitudes.length < 4) return GESTURE_GAP;
  const intervals = magnitudes.slice(1).map((m, i) => m.t - magnitudes[i]!.t).sort((x, y) => x - y);
  const median = intervals[Math.floor(intervals.length / 2)]!;
  return Math.min(GESTURE_GAP, Math.max(MIN_RELEASE_GAP, median * CADENCE_SLACK));
}

function releaseByGap() {
  gapTimer = undefined;
  if (swallowing) return;
  const ignored = gesture.state === "ignored";
  swallowing = end(false, lastEventAt);
  if (ignored) gesture.state = "idle";
  magnitudes = [];
}

function onWheel(e: WheelEvent) {
  if (e.ctrlKey || !targets.size) return;
  const t = e.timeStamp / 1000;
  const scrollingDx = -e.deltaX;
  const scrollingDy = -e.deltaY;
  if (!isPrecise(e)) {
    if (Math.abs(scrollingDx) <= Math.abs(scrollingDy)) return;
    const hit = e.target instanceof Element ? e.target : null;
    if (wheelStep(targetAt(e.clientX, e.clientY, hit), hit, scrollingDx)) e.preventDefault();
    return;
  }
  const magnitude = Math.hypot(e.deltaX, e.deltaY);
  const interval = t - lastEventAt;
  const live = gesture.state !== "idle";
  let fresh = false;
  if (swallowing) {
    if (interval > MOMENTUM_START_WAIT || magnitude > Math.max(2, lastMagnitude * RESUME_JUMP)) {
      swallowing = false;
      fresh = true;
    }
  } else fresh = !live || interval > releaseGap();
  lastEventAt = t;
  lastMagnitude = magnitude;
  clearTimeout(gapTimer);
  if (swallowing) {
    e.preventDefault();
    return;
  }
  if (fresh) {
    if (gesture.state === "pending" || gesture.state === "tracking") end(false, t);
    magnitudes = [];
    const hit = e.target instanceof Element ? e.target : null;
    prepare(e.clientX, e.clientY, hit, t);
    begin(e.clientX, e.clientY, hit, t);
  }
  magnitudes.push({ t, m: magnitude });
  if (magnitudes.length > 12) magnitudes.shift();
  if (gesture.state === "tracking" && looksLikeMomentum()) {
    swallowing = end(false, t);
    magnitudes = [];
    e.preventDefault();
    return;
  }
  const handled = update(scrollingDx, scrollingDy, t);
  if (gesture.state !== "idle") gapTimer = setTimeout(releaseByGap, releaseGap() * 1000);
  if (handled) e.preventDefault();
}

let installed = false;
function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("wheel", onWheel, { capture: true, passive: false });
}

export async function simulate(target: SwipeTarget, steps: SwipeStep[], point?: { x?: number; y?: number }) {
  const node = target.node();
  if (!node) return { error: "no node" };
  const r = node.getBoundingClientRect();
  const x = r.left + (point?.x ?? r.width / 2);
  const y = r.top + (point?.y ?? r.height / 2);
  const hit = document.elementFromPoint(x, y);
  const log: string[] = [];
  for (const step of steps) {
    if (step.delayMs) await new Promise((resolve) => setTimeout(resolve, step.delayMs));
    const t = performance.now() / 1000;
    const dx = step.dx ?? 0;
    const dy = step.dy ?? 0;
    switch (step.phase) {
      case "mayBegin":
        prepare(x, y, hit, t);
        break;
      case "began":
        begin(x, y, hit, t);
        update(dx, dy, t);
        break;
      case "changed":
        update(dx, dy, t);
        break;
      case "ended":
      case "cancelled":
        if (dx || dy) update(dx, dy, t);
        end(step.phase === "cancelled", t);
        break;
      case "wheel":
        wheelStep(targetAt(x, y, hit), hit, dx);
        break;
      case "swipe": {
        const back = dx > 0;
        if (back ? target.canSwipeBack() : target.canSwipeForward())
          target.onSwipe({ phase: "swipe", direction: back ? "back" : "forward", distance: 0, dy: 0, velocity: 0, available: true, width: r.width });
        break;
      }
      default:
        break;
    }
    log.push(`${step.phase}:${gesture.state}`);
  }
  return { ok: true, log };
}
