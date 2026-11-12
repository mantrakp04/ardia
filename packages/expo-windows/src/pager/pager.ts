export type PagerPhase = "idle" | "tracking" | "holding" | "settling";

export type PagerStateEvent = {
  phase: "began" | "selected" | "settled";
  sequence: number;
  position: number;
  selected: number;
  velocity: number;
  profileId?: string | null;
};

export type PagerSnapshot = {
  sequence: number;
  selectionSequence: number;
  position: number;
  selected: number;
  phase: PagerPhase;
  velocity: number;
  count: number;
  profileId?: string | null;
};

export type PagerArea = {
  position(position: number): boolean;
  state(event: PagerStateEvent): void;
};

export type PagerConfig = { selected: number; count: number; ack: number; width: number; order?: readonly string[] };

export type PagerClock = {
  now(): number;
  requestFrame(frame: () => void): number;
  cancelFrame(id: number): void;
  reducedMotion(): boolean;
  startMotion?(): () => void;
};

export const OMEGA = (2 * Math.PI) / 0.25;
export const REST_DISPLACEMENT = 0.003;
export const REST_SPEED = 0.1;
export const LONGEST_STEP_MS = 100;

type Spring = { from: number; target: number; velocity: number; elapsed: number; last: number };

const sameOrder = (a: readonly string[] | undefined, b: readonly string[] | undefined) =>
  a === b || (!!a && !!b && a.length === b.length && a.every((id, i) => id === b[i]));

const clampIndex = (index: number, count: number) => Math.min(Math.max(index, 0), count - 1);

export function springAt(from: number, target: number, velocity: number, seconds: number) {
  const x0 = from - target;
  const b = velocity + OMEGA * x0;
  const decay = Math.exp(-OMEGA * seconds);
  return { offset: (x0 + b * seconds) * decay, velocity: (velocity - OMEGA * b * seconds) * decay };
}

export class PagerRegistry {
  readonly clock: PagerClock;
  private pagers = new Map<string, Pager>();
  private snapshots = new Map<string, PagerSnapshot>();
  private counter = 0;

  constructor(clock: PagerClock) {
    this.clock = clock;
  }

  named(key: string): Pager {
    let pager = this.pagers.get(key);
    if (!pager) this.pagers.set(key, (pager = new Pager(key, this)));
    return pager;
  }

  existing(key: string): Pager | null {
    return this.pagers.get(key) ?? null;
  }

  snapshot(key: string): PagerSnapshot | null {
    const snapshot = this.snapshots.get(key);
    return snapshot ? { ...snapshot } : null;
  }

  next(): number {
    this.counter += 1;
    return this.counter;
  }

  publish(key: string, snapshot: PagerSnapshot) {
    this.snapshots.set(key, snapshot);
  }

  forget(pager: Pager) {
    if (this.pagers.get(pager.key) !== pager) return;
    this.pagers.delete(pager.key);
    this.snapshots.delete(pager.key);
  }
}

export class Pager {
  readonly key: string;
  private registry: PagerRegistry;
  private areas = new Set<PagerArea>();
  private configured = false;
  private count = 1;
  private order: readonly string[] | undefined;
  private selected = 0;
  private position = 0;
  private velocity = 0;
  private phase: PagerPhase = "idle";
  private sequence = 0;
  private selectionSequence = 0;
  private propSelected = 0;
  private propAck = 0;
  private pageWidth = 0;
  private spring: Spring | null = null;
  private frameId: number | null = null;
  private endMotion: (() => void) | null = null;
  private generation = 0;

  constructor(key: string, registry: PagerRegistry) {
    this.key = key;
    this.registry = registry;
  }

  attach(area: PagerArea) {
    this.areas.add(area);
    if (this.configured) area.position(this.position);
  }

  detach(area: PagerArea) {
    this.areas.delete(area);
    this.prune();
  }

  private prune() {
    if (this.areas.size > 0 || this.registry.existing(this.key) !== this) return;
    this.stopSpring();
    this.registry.forget(this);
  }

  configure({ selected, count: newCount, ack, width, order }: PagerConfig) {
    const count = Math.max(1, newCount);
    this.pageWidth = width;
    this.propSelected = clampIndex(selected, count);
    this.propAck = Math.max(this.propAck, ack);
    if (!this.configured) {
      this.configured = true;
      this.count = count;
      this.order = order;
      this.selected = this.propSelected;
      this.position = this.selected;
      this.sequence = this.registry.next();
      this.publish();
      this.emitPosition();
      return;
    }
    if (count !== this.count || (order !== undefined && !sameOrder(order, this.order))) {
      let index = this.propSelected;
      const old = this.order;
      this.count = count;
      this.order = order;
      if (this.propAck < this.selectionSequence && old && this.selected < old.length && order) {
        const moved = order.indexOf(old[this.selected]!);
        if (moved >= 0) index = moved;
      }
      this.cancelMotion();
      this.jump(index);
      return;
    }
    this.reconcile();
  }

  switchTo(index: number, order?: readonly string[]): boolean {
    if (!this.configured) return false;
    this.sync(order);
    const target = clampIndex(index, this.count);
    const v = this.phase === "settling" ? this.velocity : 0;
    this.settle(target, this.towards(target, v));
    return true;
  }

  step(delta: number, wrap: boolean, order?: readonly string[]): boolean {
    if (!this.configured) return false;
    this.sync(order);
    const target = wrap ? (((this.selected + delta) % this.count) + this.count) % this.count : clampIndex(this.selected + delta, this.count);
    return target === this.selected || this.switchTo(target);
  }

  select(profileId: string, ids: readonly string[]): boolean {
    if (!this.configured) return false;
    const index = ids.indexOf(profileId);
    if (index < 0) return false;
    this.cancelMotion();
    this.count = ids.length;
    this.order = ids;
    this.jump(index, true);
    this.emitState("selected");
    return true;
  }

  debug() {
    return {
      ...(this.registry.snapshot(this.key) ?? {}),
      areas: this.areas.size,
      propSelected: this.propSelected,
      propAck: this.propAck,
      width: this.pageWidth,
    };
  }

  private sync(ids: readonly string[] | undefined) {
    if (!ids || ids.length === 0 || sameOrder(ids, this.order)) return;
    const current = this.order && this.selected < this.order.length ? this.order[this.selected] : undefined;
    const id = current !== undefined && ids.includes(current) ? current : ids[clampIndex(this.propSelected, ids.length)]!;
    this.select(id, ids);
  }

  private reconcile() {
    if (this.phase !== "idle" || this.propAck < this.selectionSequence || this.propSelected === this.selected) return;
    this.jump(this.propSelected);
  }

  private jump(index: number, selection = false) {
    this.selected = index;
    this.position = index;
    this.velocity = 0;
    this.sequence = this.registry.next();
    if (selection) this.selectionSequence = this.sequence;
    this.publish();
    this.emitPosition();
  }

  private towards(target: number, v: number) {
    const d = target - this.position;
    return d !== 0 && v !== 0 && d > 0 === v > 0 ? v : 0;
  }

  private settle(target: number, v: number) {
    if (target !== this.selected) {
      this.selected = target;
      this.sequence = this.registry.next();
      this.selectionSequence = this.sequence;
      this.publish();
      this.emitState("selected");
    }
    this.stopSpring();
    if (this.registry.clock.reducedMotion()) return this.rest(target);
    this.phase = "settling";
    this.velocity = v;
    this.spring = { from: this.position, target, velocity: v, elapsed: 0, last: this.registry.clock.now() };
    this.endMotion = this.registry.clock.startMotion?.() ?? null;
    this.requestFrame();
    this.publish();
  }

  private requestFrame() {
    const generation = this.generation;
    this.frameId = this.registry.clock.requestFrame(() => {
      if (generation !== this.generation) return;
      this.frameId = null;
      this.frame();
    });
  }

  private frame() {
    const s = this.spring;
    if (!s) return;
    const now = this.registry.clock.now();
    s.elapsed += Math.min(Math.max(0, now - s.last), LONGEST_STEP_MS) / 1000;
    s.last = now;
    const { offset, velocity } = springAt(s.from, s.target, s.velocity, s.elapsed);
    if (Math.abs(offset) < REST_DISPLACEMENT && Math.abs(velocity) < REST_SPEED) {
      this.stopSpring();
      return this.rest(s.target);
    }
    this.position = s.target + offset;
    this.velocity = velocity;
    this.publish();
    this.emitPosition();
    this.requestFrame();
  }

  private rest(target: number) {
    this.position = target;
    this.velocity = 0;
    this.phase = "idle";
    this.sequence = this.registry.next();
    this.publish();
    this.emitPosition();
    this.emitState("settled");
    this.reconcile();
  }

  private stopSpring() {
    this.generation += 1;
    if (this.frameId !== null) this.registry.clock.cancelFrame(this.frameId);
    this.frameId = null;
    this.spring = null;
    const end = this.endMotion;
    this.endMotion = null;
    end?.();
  }

  private cancelMotion() {
    this.stopSpring();
    this.phase = "idle";
    this.velocity = 0;
  }

  private emitPosition() {
    for (const area of this.areas) if (area.position(this.position)) return;
  }

  private emitState(phase: PagerStateEvent["phase"]) {
    const event: PagerStateEvent = { phase, sequence: this.sequence, position: this.position, selected: this.selected, velocity: this.velocity };
    if (this.order) event.profileId = this.selectedId();
    const areas = [...this.areas];
    queueMicrotask(() => {
      for (const area of areas) if (this.areas.has(area)) area.state(event);
    });
  }

  private publish() {
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
    this.registry.publish(this.key, snapshot);
  }

  private selectedId(): string | null {
    return this.order && this.selected >= 0 && this.selected < this.order.length ? this.order[this.selected]! : null;
  }
}
