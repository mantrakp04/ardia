import type { PopoverBubbleProps } from "@ardia-real/shell";
import { useId, useState } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import { useBrowser } from "../../../../browser/src/state/browser/store";

type Point = readonly [number, number];
type Material = NonNullable<PopoverBubbleProps["material"]>;

const MATERIAL: Record<Material, { light: string; dark: string }> = {
  popover: { light: "rgba(246,246,246,0.82)", dark: "rgba(40,40,42,0.82)" },
  menu: { light: "rgba(246,246,246,0.82)", dark: "rgba(40,40,42,0.82)" },
  sheet: { light: "rgba(242,242,242,0.9)", dark: "rgba(34,34,36,0.9)" },
  hudWindow: { light: "rgba(30,30,30,0.6)", dark: "rgba(30,30,30,0.6)" },
  toolTip: { light: "rgba(250,250,250,0.92)", dark: "rgba(48,48,50,0.92)" },
};
const BACKDROP = "blur(24px) saturate(180%)";
const ARROW_SHOULDER = 3;
const ARROW_TIP = 2.5;
const COLLINEAR = 1e-6;

const round = (n: number) => +n.toFixed(3);

function tangentArc(from: Point, corner: Point, to: Point, radius: number): { path: string; end: Point } {
  const v1: Point = [from[0] - corner[0], from[1] - corner[1]];
  const v2: Point = [to[0] - corner[0], to[1] - corner[1]];
  const l1 = Math.hypot(...v1);
  const l2 = Math.hypot(...v2);
  const line = { path: `L${round(corner[0])} ${round(corner[1])}`, end: corner };
  if (radius <= 0 || l1 === 0 || l2 === 0) return line;
  const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2);
  if (Math.abs(cos) > 1 - COLLINEAR) return line;
  const reach = radius / Math.tan(Math.acos(cos) / 2);
  const start: Point = [corner[0] + (v1[0] / l1) * reach, corner[1] + (v1[1] / l1) * reach];
  const end: Point = [corner[0] + (v2[0] / l2) * reach, corner[1] + (v2[1] / l2) * reach];
  const sweep = -v1[0] * v2[1] + v1[1] * v2[0] > 0 ? 1 : 0;
  return { path: `L${round(start[0])} ${round(start[1])}A${round(radius)} ${round(radius)} 0 0 ${sweep} ${round(end[0])} ${round(end[1])}`, end };
}

export function bubblePath(width: number, height: number, radius: number, edge: PopoverBubbleProps["arrowEdge"], arrowX: number, arrowWidth: number, arrowHeight: number): string {
  const lift = edge === "top" || edge === "bottom" ? Math.min(arrowHeight, height) : 0;
  const r = Math.max(0, Math.min(radius, width / 2, (height - lift) / 2));
  const half = arrowWidth / 2;
  const arrow = lift > 0 && half > 0 && width >= 2 * (r + half);
  const y = (v: number): number => (edge === "bottom" ? height - v : v);
  const at = (px: number, py: number): Point => [px, y(py)];
  const top = lift;
  const tip = Math.min(Math.max(arrowX, r + half), width - r - half);
  const corners: [Point, number][] = [
    ...(arrow ? ([[at(tip - half, top), ARROW_SHOULDER], [at(tip, 0), ARROW_TIP], [at(tip + half, top), ARROW_SHOULDER]] as [Point, number][]) : []),
    [at(width, top), r],
    [at(width, height), r],
    [at(0, height), r],
    [at(0, top), r],
  ];
  const start = at(r, top);
  let cursor = start;
  let path = `M${round(start[0])} ${round(start[1])}`;
  corners.forEach(([corner, radius], index) => {
    const next = index + 1 < corners.length ? corners[index + 1]![0] : start;
    const arc = tangentArc(cursor, corner, next, radius);
    path += arc.path;
    cursor = arc.end;
  });
  return `${path}Z`;
}

export function PopoverBubble({
  material = "popover",
  dark,
  cornerRadius = 12,
  arrowEdge = "none",
  arrowX = 0,
  arrowWidth = 20,
  arrowHeight = 9,
  tint,
  edgeColor,
  edgeWidth = 0,
  shadowOpacity = 0,
  shadowRadius = 0,
  shadowOffsetY = 0,
  glass: _glass,
  style,
  children,
  onLayout,
  ...props
}: PopoverBubbleProps) {
  const appDark = useBrowser((s) => s.ui.appDark);
  const id = `bubble-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const measure = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((last) => (last?.width === width && last.height === height ? last : { width, height }));
    onLayout?.(event);
  };
  const shape = size && size.width > 0 && size.height > 0 ? bubblePath(size.width, size.height, cornerRadius, arrowEdge, arrowX, arrowWidth, arrowHeight) : null;
  const fill = MATERIAL[material][(dark ?? appDark) ? "dark" : "light"];
  const shadow = shadowOpacity > 0 && shadowRadius >= 0;
  const edge = !!edgeColor && edgeWidth > 0;
  return (
    <View pointerEvents="none" {...props} style={style} onLayout={measure}>
      {shape && size ? (
        <>
          <div aria-hidden style={{ position: "absolute", inset: 0, background: fill, backdropFilter: BACKDROP, WebkitBackdropFilter: BACKDROP, clipPath: `path("${shape}")` }} />
          <svg aria-hidden width={size.width} height={size.height} overflow="visible" style={{ position: "absolute", left: 0, top: 0, display: "block", overflow: "visible", pointerEvents: "none" }}>
            <defs>
              <clipPath id={`${id}-inside`}>
                <path d={shape} />
              </clipPath>
              {shadow ? (
                <>
                  <mask id={`${id}-outside`} maskUnits="userSpaceOnUse" x={-size.width} y={-size.height} width={size.width * 3} height={size.height * 3}>
                    <rect x={-size.width} y={-size.height} width={size.width * 3} height={size.height * 3} fill="#fff" />
                    <path d={shape} fill="#000" />
                  </mask>
                  <filter id={`${id}-blur`} filterUnits="userSpaceOnUse" x={-size.width} y={-size.height} width={size.width * 3} height={size.height * 3}>
                    <feGaussianBlur stdDeviation={shadowRadius} />
                    <feOffset dy={shadowOffsetY} />
                  </filter>
                </>
              ) : null}
            </defs>
            {shadow ? (
              <g mask={`url(#${id}-outside)`}>
                <path d={shape} fill="#000" fillOpacity={shadowOpacity} filter={`url(#${id}-blur)`} />
              </g>
            ) : null}
            {tint ? <path d={shape} fill={tint} /> : null}
            {edge ? <path d={shape} fill="none" stroke={edgeColor} strokeWidth={edgeWidth * 2} clipPath={`url(#${id}-inside)`} /> : null}
          </svg>
        </>
      ) : null}
      {children}
    </View>
  );
}
