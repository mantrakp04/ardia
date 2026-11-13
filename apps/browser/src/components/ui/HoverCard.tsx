import { useInterfaceMetrics, scaleInterfaceStyle } from "./interfaceSize";
import { scaleMetrics } from "../../lib/interfaceMetrics";
import { useMemo } from "react";
import { Panel, type PanelProps } from "./Panel";
import { radius, shadow, space, type Space } from "./tokens";

export type HoverCardProps = Omit<PanelProps, "fill" | "radius" | "border" | "borderWidth" | "shadow" | "material" | "glass"> & { width: number; pad?: Space };

export function HoverCard({ width, pad, style, children, ...rest }: HoverCardProps) {
  const interfaceScale = useInterfaceMetrics().factor;
  const { radius, space } = useMemo(() => ({ radius: scaleMetrics(BASE_INTERFACE_METRICS.radius, interfaceScale), space: scaleMetrics(BASE_INTERFACE_METRICS.space, interfaceScale) }), [interfaceScale]);
  return (
    <Panel {...rest} radius={radius.panel} shadow={shadow.card} style={[{ width, padding: pad ? space[pad] : undefined }, style]}>
      {children}
    </Panel>
  );
}

const BASE_INTERFACE_METRICS = { radius, space };
