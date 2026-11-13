import { createContext, useContext } from "react";
import { interfaceMetrics } from "../../lib/interfaceMetrics";
export const InterfaceMetricsContext = createContext(interfaceMetrics());
export const useInterfaceMetrics = () => useContext(InterfaceMetricsContext);
const dimensions = /^(width|height|minWidth|minHeight|maxWidth|maxHeight|top|left|right|bottom|padding.*|margin.*|gap|rowGap|columnGap|borderRadius)$/;
export function scaleInterfaceStyle<T>(baseline: T, factor: number): T {
  if (!baseline || typeof baseline !== "object") return baseline;
  return Object.fromEntries(Object.entries(baseline).map(([key, value]) => [key, typeof value === "number" && dimensions.test(key) ? value * factor : value])) as T;
}
