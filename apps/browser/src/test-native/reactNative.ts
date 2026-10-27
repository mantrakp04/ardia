export const View = () => null;

export const NativeModules: Record<string, unknown> = {};

export const Animated = { createAnimatedComponent: <Component>(component: Component) => component };

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
