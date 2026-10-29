import { Surface, type SurfaceProps } from "@ardia/shell";
import { GlassFill, liquidGlass, type GlassKind } from "./Glass";
import { hex, useTheme } from "./theme";
import { hairline, type ShadowLevel } from "./tokens";

export type PanelProps = Omit<SurfaceProps, "fill" | "cornerRadius" | "borderColor" | "borderWidth" | "shadowColor" | "shadowOpacity" | "shadowRadius" | "shadowOffset"> & {
  fill: string;
  radius: number;
  border?: string;
  borderWidth?: number;
  shadow?: ShadowLevel;
  glass?: GlassKind;
};

export function Panel({ fill, radius, border, borderWidth = hairline.panel, borderColors, shadow, glass, children, ...rest }: PanelProps) {
  const dark = useTheme().dark;
  if (glass && liquidGlass)
    return (
      <Surface {...rest} cornerRadius={radius}>
        <GlassFill kind={glass} fill={fill} radius={radius} />
        {children}
      </Surface>
    );
  return (
    <Surface
      {...rest}
      fill={hex(fill)}
      cornerRadius={radius}
      borderColors={borderColors}
      borderColor={border === undefined ? undefined : hex(border)}
      borderWidth={border === undefined ? undefined : borderWidth}
      shadowColor={shadow?.color}
      shadowOpacity={shadow && (dark ? shadow.opacity.dark : shadow.opacity.light)}
      shadowRadius={shadow?.radius}
      shadowOffset={shadow?.offset}
    >
      {children}
    </Surface>
  );
}
