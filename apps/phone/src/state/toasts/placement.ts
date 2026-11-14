export type ToastPlacement = {
  keyboardLift: number | null;
  safeBottom: number;
  barClearance: number;
  hostBottomY: number;
  barTopY: number | null;
  gap: number;
};

export function toastBottom(place: ToastPlacement): number {
  if (place.keyboardLift !== null) return place.keyboardLift + place.gap;
  const clear = place.safeBottom + place.barClearance;
  if (place.barTopY === null) return clear;
  return Math.max(clear, place.hostBottomY - place.barTopY + place.gap);
}
