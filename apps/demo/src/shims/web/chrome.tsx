import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { StyleSheet, View, type ViewProps, type ViewStyle } from "react-native";
import { useBrowser } from "../../../../browser/src/state/browser/store";
import { edgeGain, fallbackRadius, highlightMask, maskStyle, peakGain, SHADE_OUTSET, shadeMask, shapeMask, type RimCurve, type RimProfile, type ShadeProfile } from "./glassRim";

type Style = ViewStyle & Record<string, unknown>;


export function parseColor(color: string): [number, number, number, number] | null {
  const hex = color.trim().match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (hex) {
    const v = parseInt(hex[1]!, 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255, hex[2] ? parseInt(hex[2], 16) / 255 : 1];
  }
  const fn = color.match(/rgba?\(([^)]+)\)/);
  if (!fn) return null;
  const [r = 0, g = 0, b = 0, a = 1] = fn[1]!.split(",").map((v) => Number(v.trim()));
  return [r, g, b, a];
}

export const rgbaString = ([r, g, b, a]: [number, number, number, number]) => `rgba(${r},${g},${b},${+a.toFixed(4)})`;

function withOpacity(color: string, opacity: number) {
  const c = parseColor(color);
  return c ? rgbaString([c[0], c[1], c[2], c[3] * opacity]) : color;
}

export type SurfaceProps = ViewProps & {
  fill?: string;
  cornerRadius?: number;
  borderColor?: string;
  borderWidth?: number;
  borderColors?: string[];
  shadowColor?: string;
  shadowOpacity?: number;
  shadowRadius?: number;
  shadowOffset?: [number, number];
};

export const CA_SHADOW_BLUR = 2;

export function Surface({ fill, cornerRadius = 0, borderColor, borderWidth = 0, borderColors, shadowColor: color, shadowOpacity = 0, shadowRadius = 0, shadowOffset, style, children, ...props }: SurfaceProps) {
  const gradientBorder = !!borderColors && borderColors.length >= 2 && borderWidth > 0;
  const surface: Style = {
    backgroundColor: fill,
    borderRadius: cornerRadius,
    ...(borderColor && borderWidth > 0 && !gradientBorder ? { borderColor, borderWidth, borderStyle: "solid" } : {}),
  };
  if (color && shadowOpacity > 0) {
    const [x, y] = shadowOffset ?? [0, 0];
    surface.boxShadow = `${x}px ${y}px ${shadowRadius * CA_SHADOW_BLUR}px ${withOpacity(color, shadowOpacity)}`;
  }
  return (
    <View {...props} style={[surface, style]}>
      {gradientBorder ? (
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            borderRadius: cornerRadius,
            border: `${borderWidth}px solid transparent`,
            background: `linear-gradient(to bottom, ${borderColors!.join(", ")}) border-box`,
            mask: "linear-gradient(#000 0 0) padding-box exclude, linear-gradient(#000 0 0) border-box",
            WebkitMask: "linear-gradient(#000 0 0) padding-box, linear-gradient(#000 0 0) border-box",
            WebkitMaskComposite: "xor",
          }}
        />
      ) : null}
      {children}
    </View>
  );
}

const MATERIAL_FILL: Record<string, string> = {
  popover: "rgba(246,246,246,0.72)",
  menu: "rgba(246,246,246,0.72)",
  hudWindow: "rgba(30,30,30,0.6)",
  sidebar: "rgba(240,240,240,0.5)",
  underWindowBackground: "rgba(240,240,240,0.4)",
};

export type VisualEffectProps = ViewProps & { material?: string; blendingMode?: "withinWindow" | "behindWindow"; cornerRadius?: number };

export function VisualEffect({ material = "popover", cornerRadius, style, ...props }: VisualEffectProps) {
  const glass: Style = {
    backgroundColor: MATERIAL_FILL[material] ?? "rgba(246,246,246,0.6)",
    backdropFilter: "blur(24px) saturate(180%)",
    WebkitBackdropFilter: "blur(24px) saturate(180%)",
    borderRadius: cornerRadius,
    overflow: cornerRadius ? "hidden" : undefined,
  };
  return <View {...props} style={[glass, style]} />;
}

export type GlassEffectProps = ViewProps & { cornerRadius?: number; tint?: string; glassStyle?: "regular" | "clear"; dark?: boolean };

type GlassLook = { saturate: number; slope: number; offset: number; rim: RimProfile; shade: ShadeProfile };

const RIM_ANGLES = [0, 1, 8.5, 25, 45, 65, 81.5, 89, 90];
const RIM_DEPTHS = [0, 0.25, 0.75, 1.25, 1.75];
const GLOW_BY_ANGLE: RimCurve = [[0, 1], [5, 0.9], [10, 0.8], [20, 0.7], [35, 0.6], [90, 0.6]];

export const GLASS: { light: GlassLook; dark: GlassLook } = {
  light: {
    saturate: 1.8705,
    slope: 0.6098,
    offset: 98.2,
    rim: {
      angles: RIM_ANGLES,
      depths: RIM_DEPTHS,
      gains: [
        [0.42, 0.42, 0.16, 0, 0],
        [0.16, 0.16, 0.13, 0, 0],
        [0.16, 0.16, 0.12, 0, 0],
        [0.1, 0.105, 0.04, 0, 0],
        [0.085, 0.088, 0.03, 0, 0],
        [0.11, 0.114, 0.033, 0, 0],
        [0.03, 0.03, 0.045, 0.025, 0.01],
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
      ],
      glow: [[0, 0.14], [1.25, 0.14], [1.75, 0.12], [2.25, 0.1], [2.75, 0.09], [3.25, 0.08], [3.75, 0.07], [4.25, 0.06], [5, 0.05], [6, 0.03], [7, 0.015], [8, 0]],
      glowByAngle: GLOW_BY_ANGLE,
    },
    shade: {
      line: [[0, 1], [0.45, 1], [0.6, 0]],
      byAngle: [[0, 0.1], [8.5, 0.1], [25, 0.13], [45, 0.16], [65, 0.19], [81.5, 0.22], [89, 0.27], [90, 0.29]],
    },
  },
  dark: {
    saturate: 1.2652,
    slope: 0.8684,
    offset: 32.48,
    rim: {
      angles: RIM_ANGLES,
      depths: RIM_DEPTHS,
      gains: [
        [0.55, 0.55, 0.26, 0, 0],
        [0.22, 0.22, 0.2, 0, 0],
        [0.18, 0.18, 0.18, 0, 0],
        [0.16, 0.168, 0.05, 0, 0],
        [0.18, 0.186, 0.065, 0, 0],
        [0.106, 0.107, 0.039, 0, 0],
        [0, 0, 0.05, 0, 0],
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
      ],
      glow: [[0, 0.14], [1.25, 0.14], [1.75, 0.11], [2.25, 0.09], [2.75, 0.07], [3.25, 0.05], [3.75, 0.04], [4.25, 0.03], [5, 0.02], [6, 0.01], [7, 0]],
      glowByAngle: GLOW_BY_ANGLE,
    },
    shade: {
      line: [[0, 1], [0.45, 1], [0.6, 0]],
      byAngle: [[0, 0], [8.5, 0.02], [25, 0.02], [45, 0.1], [65, 0.15], [81.5, 0.33], [89, 0.47], [90, 0.51]],
    },
  },
};

function glassFilter(saturate: number, slope: number, offset: number) {
  const brightness = slope + (2 * offset) / 255;
  return `saturate(${saturate}) contrast(${(slope / brightness).toFixed(5)}) brightness(${brightness.toFixed(5)})`;
}

function fallbackBands(rim: RimProfile) {
  const peak = peakGain(rim);
  const stops = rim.glow.map(([d]) => [d, edgeGain(rim, d) / peak] as const);
  const top = stops.map(([at, alpha]) => `rgba(0,0,0,${alpha.toFixed(3)}) ${at}px`).join(", ");
  const bottom = [...stops].reverse().map(([at, alpha]) => `rgba(0,0,0,${alpha.toFixed(3)}) calc(100% - ${at}px)`).join(", ");
  return `linear-gradient(to bottom, ${top}, ${bottom})`;
}

const layer: React.CSSProperties = { position: "absolute", inset: 0, pointerEvents: "none" };

function backdrop(filter: string, extra?: Record<string, string>): React.CSSProperties {
  return { ...layer, backdropFilter: filter, WebkitBackdropFilter: filter, ...extra };
}

function inScrollView(node: Element | null) {
  for (let a = node?.parentElement; a; a = a.parentElement) {
    const overflow = getComputedStyle(a).overflowY;
    if (overflow === "auto" || overflow === "scroll") return true;
  }
  return false;
}

export function GlassEffect({ cornerRadius = 0, tint, glassStyle = "regular", dark, style, ...props }: GlassEffectProps) {
  const appDark = useBrowser((s) => s.ui.appDark);
  const theme = (dark ?? appDark) ? "dark" : "light";
  const g = GLASS[theme];
  const clear = glassStyle === "clear";
  const filter = clear ? glassFilter(1, (1 + g.slope) / 2, g.offset / 2) : glassFilter(g.saturate, g.slope, g.offset);
  const host = useRef<HTMLDivElement | null>(null);
  const [scrolled, setScrolled] = useState(false);
  useLayoutEffect(() => setScrolled(inScrollView(host.current)), []);
  const highlight = highlightMask(cornerRadius, g.rim, theme);
  const shape = shapeMask(cornerRadius);
  const shade = scrolled ? shadeMask(cornerRadius, g.shade, theme) : null;
  const clip: React.CSSProperties = shape ? {} : { borderRadius: fallbackRadius(cornerRadius), overflow: "hidden" };
  const shaped = shape ? maskStyle(shape) : {};
  const { opacity, ...rest } = StyleSheet.flatten(style) ?? {};
  const fade: React.CSSProperties = opacity === undefined ? {} : { opacity: Number(opacity) };
  return (
    <View pointerEvents="none" {...props} style={rest}>
      <div ref={host} style={{ ...layer, ...clip }}>
        <div style={{ ...backdrop(filter, shaped), ...fade }} />
        {tint ? <div style={{ ...layer, ...shaped, background: tint, ...fade }} /> : null}
        <div style={{ ...backdrop(`brightness(${1 + peakGain(g.rim)})`, highlight ? maskStyle(highlight) : { mask: fallbackBands(g.rim), WebkitMask: fallbackBands(g.rim) }), ...fade }} />
      </div>
      {shade ? <div style={{ ...layer, inset: -SHADE_OUTSET, background: "#000", ...maskStyle(shade), ...fade }} /> : null}
    </View>
  );
}

export type ContextMenuAreaProps = ViewProps & { onContextMenu?: () => void; captureDescendants?: boolean };

export function ContextMenuArea({ onContextMenu, captureDescendants: _capture, ...props }: ContextMenuAreaProps) {
  const WebView = View as unknown as React.ComponentType<ViewProps & { onContextMenu?: (e: MouseEvent) => void }>;
  return (
    <WebView
      {...props}
      onContextMenu={(e) => {
        if (!onContextMenu) return;
        e.preventDefault();
        e.stopPropagation();
        onContextMenu();
      }}
    />
  );
}

export function OutsidePressArea({ onOutsidePress, ...props }: ViewProps & { onOutsidePress?: (event: { nativeEvent: { timestamp?: number } }) => void; children?: ReactNode }) {
  const node = useRef<HTMLElement | null>(null);
  const latest = useRef(onOutsidePress);
  latest.current = onOutsidePress;
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (node.current && e.target instanceof Node && !node.current.contains(e.target)) latest.current?.({ nativeEvent: { timestamp: e.timeStamp } });
    };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, []);
  return <View {...props} ref={(view) => void (node.current = view as unknown as HTMLElement | null)} />;
}

export function WindowDragRegion({
  titleBarDoubleClick: _double,
  clickable: _clickable,
  onRegionClick,
  onRegionDoubleClick,
  ...props
}: ViewProps & { titleBarDoubleClick?: boolean; clickable?: boolean; onRegionClick?: () => void; onRegionDoubleClick?: () => void }) {
  const Region = View as unknown as React.ComponentType<ViewProps & { onClick?: () => void; onDoubleClick?: () => void }>;
  return <Region {...props} onClick={onRegionClick} onDoubleClick={onRegionDoubleClick} />;
}

export type DockSelectionProps = ViewProps & { fill?: string; stroke?: string; cornerRadius?: number; strokeWidth?: number; dark: boolean };

export function DockSelection({ fill, stroke, cornerRadius, strokeWidth, dark: _dark, style, ...props }: DockSelectionProps & Record<string, unknown>) {
  return <View {...props} style={[{ backgroundColor: fill, borderColor: stroke, borderWidth: stroke ? (strokeWidth ?? 1) : 0, borderRadius: cornerRadius }, style]} />;
}
