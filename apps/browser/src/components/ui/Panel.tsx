import { Surface, type SurfaceProps } from "@ardia/shell";
import { hex, useTheme } from "./theme";
import { hairline, type ShadowLevel } from "./tokens";

export type PanelProps = Omit<SurfaceProps, "fill" | "cornerRadius" | "borderColor" | "borderWidth" | "shadowColor" | "shadowOpacity" | "shadowRadius" | "shadowOffset"> & {
  fill: string;
  radius: number;
  border?: string;
  borderWidth?: number;
  shadow?: ShadowLevel;
};

export function Panel({ fill, radius, border, borderWidth = hairline.panel, shadow, children, ...rest }: PanelProps) {
  const dark = useTheme().dark;
  return (
    <Surface
      {...rest}
      fill={hex(fill)}
      cornerRadius={radius}
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
