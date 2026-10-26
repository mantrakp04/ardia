import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

const useWidths = create<Record<string, number>>()(() => ({}));

export const useMeasuredWidth = (key: string): number | undefined => useWidths((w) => w[key]);
export const useMeasuredWidths = (keys: string[]): (number | undefined)[] => useWidths(useShallow((w) => keys.map((k) => w[k])));

export function setMeasuredWidth(key: string, width: number) {
  if (useWidths.getState()[key] !== width) useWidths.setState({ [key]: width });
}
