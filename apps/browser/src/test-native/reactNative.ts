export const View = () => null;

export const NativeModules: Record<string, unknown> = {
  ACFieldTiming: { setEnabled: () => {}, markFrame: () => {}, lastInput: () => [0, 0], drain: () => [] },
};

type Finished = { finished: boolean };
type Done = (result: Finished) => void;
type Running = { value: AnimatedValue; to: number; done?: Done };

export const animations = {
  held: false,
  running: [] as Running[],
  step(value: AnimatedValue, to: number) {
    value.move(to);
  },
  finish() {
    const running = animations.running;
    animations.running = [];
    for (const r of running) {
      if (r.value.running !== r) continue;
      r.value.running = null;
      r.value.move(r.to);
      r.done?.({ finished: true });
    }
  },
};

class AnimatedValue {
  value: number;
  running: Running | null = null;
  private listeners = new Map<string, (state: { value: number }) => void>();
  private nextListener = 0;
  constructor(value = 0) {
    this.value = value;
  }
  move(value: number) {
    this.value = value;
    for (const listener of this.listeners.values()) listener({ value });
  }
  private halt() {
    const running = this.running;
    this.running = null;
    running?.done?.({ finished: false });
  }
  setValue(value: number) {
    this.halt();
    this.move(value);
  }
  stopAnimation(callback?: (value: number) => void) {
    this.halt();
    callback?.(this.value);
  }
  __getValue() {
    return this.value;
  }
  addListener(listener: (state: { value: number }) => void) {
    const id = String(this.nextListener++);
    this.listeners.set(id, listener);
    return id;
  }
  removeListener(id: string) {
    this.listeners.delete(id);
  }
  interpolate(config: { inputRange: number[]; outputRange: number[] }) {
    return { config, source: this };
  }
}

class AnimatedValueXY {
  x: AnimatedValue;
  y: AnimatedValue;
  constructor(at: { x: number; y: number } = { x: 0, y: 0 }) {
    this.x = new AnimatedValue(at.x);
    this.y = new AnimatedValue(at.y);
  }
  setValue(at: { x: number; y: number }) {
    this.x.setValue(at.x);
    this.y.setValue(at.y);
  }
  stopAnimation(callback?: (at: { x: number; y: number }) => void) {
    this.x.stopAnimation();
    this.y.stopAnimation();
    callback?.({ x: this.x.value, y: this.y.value });
  }
  __getValue() {
    return { x: this.x.value, y: this.y.value };
  }
  getTranslateTransform() {
    return [{ translateX: this.x }, { translateY: this.y }];
  }
}

type Animation = { start(done?: Done): void; stop(): void };

function animateOne(value: AnimatedValue, to: number): Animation {
  let mine: Running | null = null;
  return {
    start(done) {
      value.stopAnimation();
      mine = { value, to, done };
      value.running = mine;
      if (animations.held) return void animations.running.push(mine);
      value.running = null;
      value.move(to);
      done?.({ finished: true });
    },
    stop() {
      if (mine && value.running === mine) value.stopAnimation();
    },
  };
}

function together(list: Animation[], done?: Done) {
  let left = list.length;
  let finished = true;
  if (!left) return done?.({ finished: true });
  for (const a of list)
    a.start((r) => {
      finished &&= r.finished;
      if (--left === 0) done?.({ finished });
    });
}

function animate(value: AnimatedValue | AnimatedValueXY, toValue: number | { x: number; y: number }): Animation {
  if (value instanceof AnimatedValueXY) {
    const to = toValue as { x: number; y: number };
    const parts = [animateOne(value.x, to.x), animateOne(value.y, to.y)];
    return { start: (done) => together(parts, done), stop: () => parts.forEach((p) => p.stop()) };
  }
  return animateOne(value, toValue as number);
}

export const Animated = {
  createAnimatedComponent: <Component>(component: Component) => component,
  Value: AnimatedValue,
  ValueXY: AnimatedValueXY,
  spring: (value: AnimatedValue | AnimatedValueXY, config: { toValue: number | { x: number; y: number } }) => animate(value, config.toValue),
  timing: (value: AnimatedValue | AnimatedValueXY, config: { toValue: number | { x: number; y: number } }) => animate(value, config.toValue),
  parallel: (list: Animation[]): Animation => ({ start: (done) => together(list, done), stop: () => list.forEach((a) => a.stop()) }),
};

export const findNodeHandle = () => null;

export const unstable_batchedUpdates = (update: () => void) => update();

type Curve = (t: number) => number;
const identity: Curve = (t) => t;
export const Easing = {
  linear: identity,
  ease: identity,
  quad: identity,
  cubic: identity,
  sin: identity,
  exp: identity,
  back: (_overshoot?: number) => identity,
  bezier: (_x1: number, _y1: number, _x2: number, _y2: number) => identity,
  in: (curve: Curve) => curve,
  out: (curve: Curve) => curve,
  inOut: (curve: Curve) => curve,
};
