import { Panel, type PanelProps } from "./Panel";
import { radius, shadow, space, type Space } from "./tokens";

export type HoverCardProps = Omit<PanelProps, "fill" | "radius" | "border" | "borderWidth" | "shadow" | "material" | "glass"> & { width: number; pad?: Space };

export function HoverCard({ width, pad, style, children, ...rest }: HoverCardProps) {
  return (
    <Panel {...rest} radius={radius.panel} shadow={shadow.card} style={[{ width, padding: pad ? space[pad] : undefined }, style]}>
      {children}
    </Panel>
  );
}
