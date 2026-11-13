import type { ReactNode } from "react";
import { useSettings } from "../../state/browser/hooks";
import { interfaceMetrics } from "../../lib/interfaceMetrics";
import { InterfaceMetricsContext } from "../ui/interfaceSize";
export function InterfaceSizeProvider({ children }: { children: ReactNode }) {
  const preset = useSettings((s) => s.interfaceSize);
  return <InterfaceMetricsContext.Provider value={interfaceMetrics(preset)}>{children}</InterfaceMetricsContext.Provider>;
}
