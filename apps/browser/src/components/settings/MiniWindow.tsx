import type { ReactNode } from "react";
import { View, type DimensionValue } from "react-native";
import { capsule, radius } from "../ui";
import { miniWindow, type MiniWindowGeometry } from "./tokens";

export type MiniWindowLook = { window: string; bar: string; page: string; field?: string; accent?: string; edge?: string };

export type MiniWindowSize = keyof typeof miniWindow;

const chromeRadius = (g: MiniWindowGeometry, height: number) => Math.min(radius.chrome * g.scale, capsule(height));

export function MiniWindow({
  layout,
  bars = 3,
  accentBar,
  field,
  look,
  size = "m",
  children,
}: {
  layout: "side" | "top" | "none";
  bars?: number | number[];
  accentBar?: number;
  field?: "side" | "toolbar";
  look: MiniWindowLook;
  size?: MiniWindowSize;
  children?: ReactNode;
}) {
  const g = miniWindow[size];
  const widths = typeof bars === "number" ? Array.from({ length: bars }, () => 1) : bars;
  const barColor = (i: number) => (i === accentBar && look.accent ? look.accent : look.bar);
  const fieldStyle = (height: number) => ({
    height,
    borderRadius: chromeRadius(g, height),
    backgroundColor: look.field ?? look.bar,
    borderWidth: look.accent ? 1 : 0,
    borderColor: look.accent,
  });
  return (
    <View style={{ flex: 1, padding: g.pad, gap: g.gap, flexDirection: layout === "top" ? "column" : "row", backgroundColor: look.window }}>
      {layout === "side" && (
        <View style={{ width: g.side, gap: g.barGap, paddingTop: field === "side" ? g.sideFieldTop : g.sideTop }}>
          {field === "side" && <View style={fieldStyle(g.sideField)} />}
          {widths.map((w, i) => (
            <View key={i} style={{ width: `${w * 100}%` as DimensionValue, height: g.bar, borderRadius: capsule(g.bar), backgroundColor: barColor(i) }} />
          ))}
        </View>
      )}
      {layout === "top" && (
        <View style={{ height: g.tab, flexDirection: "row", gap: g.barGap, paddingLeft: g.tabsLeft }}>
          {widths.map((w, i) => (
            <View key={i} style={{ flex: w, borderRadius: chromeRadius(g, g.tab), backgroundColor: barColor(i) }} />
          ))}
        </View>
      )}
      {children ?? (
        <View style={{ flex: 1, borderRadius: radius.chrome * g.scale, backgroundColor: look.page, overflow: "hidden", borderWidth: look.edge ? 1 : 0, borderColor: look.edge }}>
          {field === "toolbar" && (
            <View style={{ height: g.toolbar, flexDirection: "row", alignItems: "center", paddingHorizontal: g.barGap, gap: g.barGap, borderBottomWidth: 1, borderBottomColor: look.field ?? look.bar }}>
              <View style={{ ...g.nav, borderRadius: capsule(g.nav.height), backgroundColor: look.bar }} />
              <View style={[fieldStyle(g.toolbarField), { flex: 1 }]} />
            </View>
          )}
        </View>
      )}
    </View>
  );
}
