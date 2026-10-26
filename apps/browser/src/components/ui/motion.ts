import { Easing } from "react-native";

export const curve = {
  linear: Easing.linear,
  outQuad: Easing.out(Easing.quad),
  outCubic: Easing.out(Easing.cubic),
  outExpo: Easing.out(Easing.exp),
  outBack: Easing.out(Easing.back(1.2)),
  inQuad: Easing.in(Easing.quad),
  inCubic: Easing.in(Easing.cubic),
  inEase: Easing.in(Easing.ease),
  inOutQuad: Easing.inOut(Easing.quad),
  inOutCubic: Easing.inOut(Easing.cubic),
  inOutSine: Easing.inOut(Easing.sin),
  fade: Easing.bezier(0.25, 0.46, 0.45, 0.94),
  fold: Easing.bezier(0.2, 0.9, 0.3, 1),
  cssEase: Easing.bezier(0.25, 0.1, 0.25, 1),
  cssEaseOut: Easing.bezier(0, 0, 0.58, 1),
  flight: Easing.bezier(0.45, 0, 0.2, 1),
} as const;

export const duration = {
  instant: 100,
  popoverOpen: 150,
  popoverClose: 100,
  quick: 150,
  toggle: 160,
  colorEase: 180,
  fade: 200,
  slide: 220,
  resize: 260,
  slow: 300,
  spinnerTurn: 900,
  pulse: 1100,
} as const;

export type SpringSpec = { response: number; damping: number };

export function spring({ response, damping }: SpringSpec) {
  const omega = (2 * Math.PI) / response;
  return { stiffness: omega * omega, damping: 2 * damping * omega, mass: 1 };
}
