export type TransformStep = Record<string, unknown>;

const RESTING: Record<string, number> = { scale: 1, scaleX: 1, scaleY: 1, rotate: 0, rotateX: 0, rotateY: 0, rotateZ: 0, skewX: 0, skewY: 0 };

const amount = (value: unknown): number => (typeof value === "number" ? value : typeof value === "string" ? parseFloat(value) : NaN);

const pivots = (step: TransformStep): boolean =>
  Object.keys(step).some((key) => key in RESTING && amount(step[key]) !== RESTING[key]);

const TO_CENTRE: TransformStep[] = [{ translateX: "50%" }, { translateY: "50%" }];
const FROM_CENTRE: TransformStep[] = [{ translateX: "-50%" }, { translateY: "-50%" }];

export function aroundCentre<T>(transform: T): T | TransformStep[] {
  if (!Array.isArray(transform) || !transform.some((step) => step !== null && typeof step === "object" && pivots(step as TransformStep))) return transform;
  return [...TO_CENTRE, ...(transform as TransformStep[]), ...FROM_CENTRE];
}
