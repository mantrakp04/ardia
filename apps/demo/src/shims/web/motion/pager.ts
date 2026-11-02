import type { NativePagerConfig, PagerSnapshot, PagerStateEvent } from "@ardia-real/ardiacore";

const TRACKING_SCALE = 0.5;
const RUBBER_DIMENSION = 255;
const RUBBER_COEFFICIENT = 0.15;
const FLICK_VELOCITY = 5;
const OMEGA = (2 * Math.PI) / 0.25;
const REST_DISPLACEMENT = 0.003;
const REST_SPEED = 0.1;
const HISTORY_WINDOW = 0.1;

export const rubberBand = (value: number, dimension: number) => (1 - 1 / ((value * RUBBER_COEFFICIENT) / dimension + 1)) * dimension;

export type PagerPhase = PagerSnapshot["phase"];
export type PagerInput = "prepare" | "abandon" | "began" | "changed" | "ended" | "cancelled";

export type PagerArea = {
  pageWidth: () => number;
  attached: () => boolean;
  onPosition: (position: number) => void;
  onState: (event: PagerStateEvent) => void;
};

type Drag = { start: number; lo: number; hi: number; home: number; detent: number; area: PagerArea | null };
type Spring = { from: number; target: number; velocity: number; start: number };

const now = () => performance.now() / 1000;
const clamp = (value: number, lo: number, hi: number) => Math.min(Math.max(value, lo), hi);

let counter = 0;
const next = () => ++counter;

const pagers = new Map<string, Pager>();

const sameOrder = (a: readonly string[], b: readonly string[] | null) => !!b && a.length === b.length && a.every((id, i) => id === b[i]);

export class Pager {
  private areas = new Set<PagerArea>();
  private configured = false;
  private count = 1;
  private order: readonly string[] | null = null;
  private selected = 0;
  private position = 0;
  private velocity = 0;
  private phase: PagerPhase = "idle";
  private sequence = 0;
  private selectionSequence = 0;
  private propSelected = 0;
  private propAck = 0;
  private drag: Drag = { start: 0, lo: 0, hi: 0, home: 0, detent: 0, area: null };
  private history: { time: number; position: number }[] = [];
  private spring: Spring | null = null;
  private frameId = 0;

  static named(key: string) {
    let pager = pagers.get(key);
    if (!pager) pagers.set(key, (pager = new Pager(key)));
    return pager;
  }

  static existing(key: string) {
    return pagers.get(key);
  }

  private constructor(readonly key: string) {}

  attach(area: PagerArea) {
    this.areas.add(area);
    if (this.configured) area.onPosition(this.position);
  }

  detach(area: PagerArea) {
    this.areas.delete(area);
    if (this.drag.area === area) this.drag.area = null;
    if (this.areas.size || pagers.get(this.key) !== this) return;
    this.stopSpring();
    pagers.delete(this.key);
  }

  configure({ selected, count: rawCount, ack, order }: NativePagerConfig) {
    const count = Math.max(1, rawCount);
    this.propSelected = clamp(selected, 0, count - 1);
    this.propAck = Math.max(this.propAck, ack ?? 0);
    const newOrder = order ?? null;
    if (!this.configured) {
      this.configured = true;
      this.count = count;
      this.setOrder(newOrder);
      this.selected = this.propSelected;
      this.position = this.selected;
      this.sequence = next();
      this.emitPosition();
      return;
    }
    if (count !== this.count || (newOrder !== null && !sameOrder(newOrder, this.order))) {
      let index = this.propSelected;
      const old = this.order;
      this.count = count;
      this.setOrder(newOrder);
      if (this.propAck < this.selectionSequence && old && this.selected < old.length) {
        const moved = this.order?.indexOf(old[this.selected]!) ?? -1;
        if (moved >= 0) index = moved;
      }
      this.cancelMotion();
      this.jump(index);
      return;
    }
    this.reconcile();
  }

  private setOrder(order: readonly string[] | null) {
    this.order = order;
  }

  private reconcile() {
    if (this.phase !== "idle" || this.propAck < this.selectionSequence || this.propSelected === this.selected) return;
    this.jump(this.propSelected);
  }

  private jump(index: number, selection = false) {
    this.selected = index;
    this.position = index;
    this.velocity = 0;
    this.sequence = next();
    if (selection) this.selectionSequence = this.sequence;
    this.emitPosition();
  }

  input(area: PagerArea, input: PagerInput, distance: number, direction: number, timestamp: number) {
    switch (input) {
      case "prepare":
        if (this.phase === "settling") {
          this.stopSpring();
          this.phase = "holding";
        }
        return;
      case "abandon":
        if (this.phase === "holding") this.settle(this.selected, 0);
        else if (this.phase === "tracking" && this.drag.area === area) this.release(0, false);
        return;
      case "began":
        this.begin(area);
        this.track(distance, direction, timestamp, true);
        return;
      case "changed":
        if (this.phase !== "tracking" || this.drag.area !== area) return;
        this.track(distance, direction, timestamp, true);
        return;
      case "ended":
      case "cancelled":
        if (this.phase !== "tracking" || this.drag.area !== area) return;
        this.track(distance, direction, timestamp, false);
        this.release(this.releaseVelocity(timestamp), input === "cancelled");
    }
  }

  private begin(area: PagerArea) {
    this.stopSpring();
    const home = this.selected;
    const x = this.position;
    const lo = Math.max(0, Math.min(home - 1, Math.floor(x)));
    const hi = Math.min(this.count - 1, Math.max(home + 1, Math.ceil(x)));
    this.drag = { start: x, lo, hi, home, detent: clamp(Math.round(x), lo, hi), area };
    this.history = [];
    this.velocity = 0;
    this.phase = "tracking";
    this.sequence = next();
    this.emitState("began");
  }

  private track(distance: number, direction: number, timestamp: number, sample: boolean) {
    const area = this.drag.area;
    if (!area) return;
    const width = area.pageWidth();
    if (!(width > 0)) return;
    const raw = this.drag.start + (direction > 0 ? -1 : 1) * ((distance * TRACKING_SCALE) / width);
    const { lo, hi } = this.drag;
    const x = raw > hi ? hi + rubberBand((raw - hi) * width, RUBBER_DIMENSION) / width : raw < lo ? lo - rubberBand((lo - raw) * width, RUBBER_DIMENSION) / width : raw;
    this.position = x;
    if (sample) {
      const time = Math.max(timestamp, this.history.at(-1)?.time ?? timestamp);
      this.history.push({ time, position: x });
      this.history = this.history.filter((h) => time - h.time <= HISTORY_WINDOW);
    }
    this.drag.detent = clamp(Math.round(x), lo, hi);
    this.emitPosition();
  }

  private releaseVelocity(timestamp: number) {
    const recent = this.history.filter((h) => timestamp - h.time <= HISTORY_WINDOW);
    const first = recent[0];
    const last = recent.at(-1);
    if (recent.length < 2 || !first || !last || last.time <= first.time) return 0;
    return (last.position - first.position) / (last.time - first.time);
  }

  private release(v: number, cancelled: boolean) {
    const home = this.drag.home;
    const width = this.drag.area?.pageWidth() ?? 0;
    this.drag.area = null;
    let target = home;
    if (!cancelled) {
      const flick = Math.abs(v * width) >= FLICK_VELOCITY;
      target = !flick ? Math.round(this.position) : v > 0 ? Math.floor(this.position) + 1 : Math.ceil(this.position) - 1;
      target = Math.max(0, home - 1, Math.min(this.count - 1, home + 1, target));
    }
    this.settle(target, this.towards(target, v));
  }

  private towards(target: number, v: number) {
    const d = target - this.position;
    return d !== 0 && v !== 0 && d > 0 === v > 0 ? v : 0;
  }

  switchTo(index: number, order?: readonly string[]) {
    if (!this.configured) return false;
    this.sync(order);
    const target = clamp(index, 0, this.count - 1);
    this.drag.area = null;
    const v = this.phase === "settling" ? this.velocity : 0;
    this.settle(target, this.towards(target, v));
    return true;
  }

  private sync(order?: readonly string[]) {
    if (order === undefined || sameOrder(order, this.order)) return;
    const ids = order;
    if (!ids.length) return;
    const current = this.order && this.selected < this.order.length ? this.order[this.selected] : undefined;
    const id = current !== undefined && ids.includes(current) ? current : ids[clamp(this.propSelected, 0, ids.length - 1)]!;
    this.select(id, order);
  }

  select(profileId: string, order: readonly string[]) {
    if (!this.configured) return false;
    const ids = order;
    const index = ids.indexOf(profileId);
    if (index < 0) return false;
    this.cancelMotion();
    this.count = ids.length;
    this.setOrder(order);
    this.jump(index, true);
    this.emitState("selected");
    return true;
  }

  step(delta: number, wrap: boolean, order?: readonly string[]) {
    if (!this.configured) return false;
    this.sync(order);
    const target = wrap ? (((this.selected + delta) % this.count) + this.count) % this.count : clamp(this.selected + delta, 0, this.count - 1);
    return target === this.selected || this.switchTo(target);
  }

  private settle(target: number, v: number) {
    if (target !== this.selected) {
      this.selected = target;
      this.sequence = next();
      this.selectionSequence = this.sequence;
      this.emitState("selected");
    }
    this.stopSpring();
    this.phase = "settling";
    this.velocity = v;
    this.spring = { from: this.position, target, velocity: v, start: now() };
    const frame = () => {
      this.frameId = 0;
      if (!this.spring) return;
      this.stepSpring();
      if (this.spring) this.frameId = requestAnimationFrame(frame);
    };
    this.frameId = requestAnimationFrame(frame);
  }

  private stepSpring() {
    const s = this.spring;
    if (!s) return;
    const t = now() - s.start;
    const x0 = s.from - s.target;
    const b = s.velocity + OMEGA * x0;
    const decay = Math.exp(-OMEGA * t);
    const x = (x0 + b * t) * decay;
    const v = (s.velocity - OMEGA * b * t) * decay;
    if (Math.abs(x) < REST_DISPLACEMENT && Math.abs(v) < REST_SPEED) {
      this.stopSpring();
      this.position = s.target;
      this.velocity = 0;
      this.phase = "idle";
      this.sequence = next();
      this.emitPosition();
      this.emitState("settled");
      this.reconcile();
      return;
    }
    this.position = s.target + x;
    this.velocity = v;
    this.emitPosition();
  }

  private stopSpring() {
    if (this.frameId) cancelAnimationFrame(this.frameId);
    this.frameId = 0;
    this.spring = null;
  }

  private cancelMotion() {
    this.stopSpring();
    this.drag.area = null;
    this.phase = "idle";
    this.velocity = 0;
  }

  private emitPosition() {
    const tracking = this.phase === "tracking" ? this.drag.area : null;
    const all = [...this.areas];
    (tracking ?? all.find((a) => a.attached()) ?? all[0])?.onPosition(this.position);
  }

  private emitState(phase: PagerStateEvent["phase"]) {
    const event: PagerStateEvent = { phase, sequence: this.sequence, position: this.position, selected: this.selected, velocity: this.velocity };
    if (this.order) event.profileId = this.selectedId();
    for (const area of [...this.areas]) area.onState(event);
  }

  private selectedId() {
    const ids = this.order;
    return ids && this.selected >= 0 && this.selected < ids.length ? ids[this.selected]! : null;
  }

  snapshot(): PagerSnapshot {
    const snapshot: PagerSnapshot = {
      sequence: this.sequence,
      selectionSequence: this.selectionSequence,
      position: this.position,
      selected: this.selected,
      phase: this.phase,
      velocity: this.velocity,
      count: this.count,
    };
    if (this.order) snapshot.profileId = this.selectedId();
    return snapshot;
  }

  debug() {
    return { ...this.snapshot(), areas: this.areas.size, propSelected: this.propSelected, propAck: this.propAck, history: this.history.length, drag: this.phase === "tracking" ? { ...this.drag, area: undefined } : undefined };
  }
}

if (import.meta.env.DEV) (globalThis as { acDemoPagers?: unknown }).acDemoPagers = pagers;
