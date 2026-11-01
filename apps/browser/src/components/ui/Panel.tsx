import { Surface, VisualEffect, type SurfaceProps } from "@ardia/shell";
import { StyleSheet } from "react-native";
import { GlassFill, useGlass } from "./Glass";
import { hex, shadowOpacityOf, useTheme } from "./theme";
import { hairline, type ShadowLevel } from "./tokens";

export type PanelShadow = ShadowLevel | (Omit<ShadowLevel, "opacity"> & { opacity: number });

export type PanelProps = Omit<SurfaceProps, "fill" | "cornerRadius" | "borderColor" | "borderWidth" | "shadowColor" | "shadowOpacity" | "shadowRadius" | "shadowOffset"> & {
  fill?: string;
  radius: number;
  border?: string | null;
  borderWidth?: number;
  shadow?: PanelShadow;
  material?: string;
  glass?: boolean;
};

export function Panel({ fill, radius, border, borderWidth = hairline.panel, borderColors, shadow, material, glass, children, ...rest }: PanelProps) {
  const theme = useTheme();
  const paneGlass = useGlass("panes");
  const fillColor = fill ?? theme.panel;
  const borderColor = border === undefined ? theme.panelBorder : border;
  if (glass && paneGlass)
    return (
      <Surface {...rest} cornerRadius={radius}>
        <GlassFill panelFill={fillColor} radius={radius} />
        {children}
      </Surface>
    );
  return (
    <Surface
      {...rest}
      fill={hex(fillColor)}
      cornerRadius={radius}
      borderColors={borderColors}
      borderColor={borderColor === null ? undefined : hex(borderColor)}
      borderWidth={borderColor === null ? undefined : borderWidth}
      shadowColor={shadow?.color}
      shadowOpacity={shadow && shadowOpacityOf(shadow, theme)}
      shadowRadius={shadow?.radius}
      shadowOffset={shadow?.offset}
    >
      {material ? <VisualEffect material={material} cornerRadius={radius} style={StyleSheet.absoluteFill} /> : null}
      {children}
    </Surface>
  );
}
