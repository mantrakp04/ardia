export const PINCH_OPEN_AT = 0.3;
export const PINCH_CLOSE_AT = -0.25;
const SPREAD_TO_TAB = 0.4;

export type PinchOutcome = "open" | "close" | "stay";
export type PinchPhase = "began" | "changed" | "ended" | "cancelled";

export function pinchOutcome(magnification: number): PinchOutcome {
  if (magnification >= PINCH_OPEN_AT) return "open";
  if (magnification <= PINCH_CLOSE_AT) return "close";
  return "stay";
}

const unit = (v: number) => Math.min(Math.max(v, 0), 1);

export function pinchFollow(magnification: number, startScale: number): { progress: number; expand: number } {
  if (magnification >= 0) return { progress: 1, expand: unit(magnification / SPREAD_TO_TAB) };
  return { progress: unit((1 + magnification - startScale) / (1 - startScale)), expand: 0 };
}

export function pinchScale(magnification: number, smallest: number, largest: number): number {
  if (magnification >= 0) return 1 + (largest - 1) * unit(magnification / SPREAD_TO_TAB);
  return Math.max(smallest, 1 + magnification);
}

export type PinchMotion = {
  reduce: boolean;
  idle: () => boolean;
  begin: () => void;
  follow: (magnification: number) => void;
  settle: () => void;
  open: () => void;
  close: () => void;
};

export function pinchStep(motion: PinchMotion, phase: PinchPhase, magnification: number) {
  if (motion.idle()) return;
  if (phase === "began" && !motion.reduce) motion.begin();
  if (phase === "ended" || phase === "cancelled") {
    const outcome = phase === "ended" ? pinchOutcome(magnification) : "stay";
    if (outcome === "close") return motion.close();
    if (outcome === "open") return motion.open();
    if (!motion.reduce) motion.settle();
    return;
  }
  if (!motion.reduce) motion.follow(magnification);
}
