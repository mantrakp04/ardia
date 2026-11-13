import { useMemo } from "react";
import { interfaceMetrics, scaleMetrics } from "../../lib/interfaceMetrics";
import { useSettings } from "../../state/browser/hooks";
import { barSizes, type BarSize } from "./tokens";

export const useBarSize = (): BarSize => {
  const size = useSettings((s) => s.bookmarksBarSize);
  const preset = useSettings((s) => s.interfaceSize);
  return useMemo(() => scaleMetrics(barSizes[size] ?? barSizes.default, interfaceMetrics(preset).factor), [size, preset]);
};

export const useBookmarksBarHeight = (): number => useBarSize().height;
