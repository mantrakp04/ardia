import type { ReactNode } from "react";
import { Animated, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { Surface, Symbol } from "../../ui";
import { hex } from "../../ui/theme";
import type { ToolbarPalette } from "../../ui/toolbarColors";
import { trafficLights } from "../tokens";
import { NEW_TAB, tab, type Tab } from "./content";
import { at, atRect, CRUMB_X, FIELD, fill, hairline, LIGHTS_Y, ROW, rowY, TOOLBAR_H, TOOLBAR_ICONS, type Geo, type Rect } from "./geometry";
import { mixColors, type Look } from "./look";
import { mockInk, tabTints } from "./tokens";

export type Styles = StyleProp<ViewStyle> | object;

export function Label({ g, size, color, weight, children, style, lines = 1, family }: { g: Geo; size: number; color: string; weight?: TextStyle["fontWeight"]; children: ReactNode; style?: StyleProp<TextStyle>; lines?: number; family?: string }) {
  return (
    <Text numberOfLines={lines} style={[{ fontSize: size * g.s, lineHeight: size * 1.3 * g.s, color, fontWeight: weight, fontFamily: family }, style]}>
      {children}
    </Text>
  );
}

export function Glyph({ g, name, size, color, weight, box }: { g: Geo; name: string; size: number; color: string; weight?: "regular" | "medium" | "semibold" | "bold"; box?: number }) {
  const b = (box ?? size + 4) * g.s;
  return <Symbol name={name} size={size * g.s} weight={weight} color={color} style={{ width: b, height: b }} />;
}

export function Backdrop({ g, look }: { g: Geo; look: Look }) {
  const bands = 10;
  return (
    <View style={[fill, { backgroundColor: look.tint[0] }]} pointerEvents="none">
      {Array.from({ length: bands - 1 }, (_, i) => (
        <View key={i} style={{ position: "absolute", left: 0, right: 0, top: `${((i + 1) / bands) * 100}%`, bottom: 0, backgroundColor: mixColors(look.tint[0], look.tint[1], (i + 1) / (bands - 1)), opacity: 1 }} />
      ))}
    </View>
  );
}

export function Lights({ g, y = LIGHTS_Y.toolbar, x = 25, style }: { g: Geo; y?: number; x?: number; style?: Styles }) {
  return (
    <Animated.View style={[at(g, x - 6, y - 6, 52, 12), style as ViewStyle]} pointerEvents="none">
      {trafficLights.map((color, i) => (
        <View key={color} style={[at(g, i * 20, 0, 12, 12), { borderRadius: 6 * g.s, backgroundColor: color, borderWidth: hairline, borderColor: mockInk.lightsRim }]} />
      ))}
    </Animated.View>
  );
}

export function Favicon({ g, t, size = 16 }: { g: Geo; t: Tab; size?: number }) {
  if (t === NEW_TAB) return <View style={{ width: size * g.s, height: size * g.s, alignItems: "center", justifyContent: "center" }}><Glyph g={g} name="plus" size={size * 0.8} color={tabTints.newTab} box={size} /></View>;
  return (
    <View style={{ width: size * g.s, height: size * g.s, borderRadius: size * 0.25 * g.s, backgroundColor: t.color, alignItems: "center", justifyContent: "center" }}>
      <Glyph g={g} name={t.icon} size={size * 0.58} color={mockInk.glyphOnTint} weight="semibold" box={size} />
    </View>
  );
}

export function Highlight({ g, look, x = ROW.x, y, w = ROW.w, h = ROW.h, style }: { g: Geo; look: Look; x?: number; y: number; w?: number; h?: number; style?: Styles }) {
  const t = look.t;
  return (
    <Animated.View style={[at(g, x, y, w, h), style as ViewStyle]} pointerEvents="none">
      <Surface
        fill={hex(t.tabSelected)}
        cornerRadius={10 * g.s}
        borderColors={t.tabSelectedBorder.map(hex)}
        borderWidth={0.5}
        shadowColor={hex(t.tabSelectedShadow)}
        shadowOpacity={1}
        shadowRadius={t.tabSelectedShadowRadius * g.s}
        shadowOffset={[0, 0.5 * g.s]}
        style={fill}
      />
    </Animated.View>
  );
}

export function TabRow({ g, look, t, x = ROW.x, y, w = ROW.w, selected, style, dim }: { g: Geo; look: Look; t: Tab; x?: number; y: number; w?: number; selected?: boolean; style?: Styles; dim?: boolean }) {
  return (
    <Animated.View style={[at(g, x, y, w, ROW.h), style as ViewStyle]}>
      {selected ? <Highlight g={g} look={look} x={0} y={0} w={w} /> : null}
      <View style={[fill, { flexDirection: "row", alignItems: "center", paddingLeft: 10 * g.s, paddingRight: 8 * g.s, gap: 10 * g.s, opacity: dim ? 0.4 : 1 }]}>
        <Favicon g={g} t={t} />
        <View style={{ flex: 1 }}>
          <Label g={g} size={13} color={t === NEW_TAB ? look.t.textSecondary : selected ? look.t.tabSelectedText : look.t.textTab}>
            {t.title}
          </Label>
        </View>
      </View>
    </Animated.View>
  );
}

export function NewTabButton({ g, look, y, style }: { g: Geo; look: Look; y: number; style?: Styles }) {
  return <TabRow g={g} look={look} t={NEW_TAB} y={y} style={style} />;
}

export function Rows({ g, look, from = 0, n, sel, top = ROW.top, newTab = true }: { g: Geo; look: Look; from?: number; n: number; sel?: number; top?: number; newTab?: boolean }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <TabRow key={i} g={g} look={look} t={tab(from + i)} y={rowY(i, top)} selected={i === sel} />
      ))}
      {newTab ? <NewTabButton g={g} look={look} y={rowY(n, top)} /> : null}
    </>
  );
}

export function NavIcons({ g, color, xs, y, names = ["sidebar.left", "chevron.left", "chevron.right", "arrow.clockwise"], style }: { g: Geo; color: string; xs: readonly number[]; y: number; names?: readonly string[]; style?: Styles }) {
  return (
    <Animated.View style={[fill, style as ViewStyle]} pointerEvents="none">
      {xs.map((x, i) => (
        <View key={i} style={[at(g, x - 10, y - 10, 20, 20), { alignItems: "center", justifyContent: "center" }]}>
          <Glyph g={g} name={names[i] ?? "circle"} size={14} color={color} weight="medium" box={20} />
        </View>
      ))}
    </Animated.View>
  );
}

export function Crumb({ g, look, t, palette, style }: { g: Geo; look: Look; t: Tab; palette?: ToolbarPalette; style?: Styles }) {
  const p = palette ?? look.plain;
  return (
    <Animated.View style={[{ flexDirection: "row", alignItems: "center" }, style as ViewStyle]}>
      <Label g={g} size={13} color={p.text} weight="500" style={{ flexShrink: 1 }}>
        {t.host.replace(/^www\./, "")}
        <Text style={{ color: p.secondary, fontWeight: "400" }}>{`  /  ${t.title}`}</Text>
      </Label>
    </Animated.View>
  );
}

export function Toolbar({ g, look, w, t, site, crumb = true, icons = TOOLBAR_ICONS, crumbX = CRUMB_X, style }: { g: Geo; look: Look; w: number; t: Tab; site?: boolean; crumb?: boolean; icons?: readonly number[]; crumbX?: number; style?: Styles }) {
  const palette = site ? look.site : look.plain;
  return (
    <Animated.View style={[at(g, 0, 0, w, TOOLBAR_H), style as ViewStyle]}>
      {palette.background ? <View style={[fill, { backgroundColor: palette.background }]} /> : null}
      <NavIcons g={g} color={palette.icon} xs={icons} y={21.2} names={icons.length === 3 ? ["chevron.left", "chevron.right", "arrow.clockwise"] : undefined} />
      {crumb ? <Crumb g={g} look={look} t={t} palette={palette} style={at(g, crumbX, 12, w - crumbX - 20, 18)} /> : null}
      {site ? null : <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: hairline, backgroundColor: palette.divider }} />}
    </Animated.View>
  );
}

export function SidebarField({ g, look, t, style, children }: { g: Geo; look: Look; t: Tab; style?: Styles; children?: ReactNode }) {
  return (
    <Animated.View style={[atRect(g, FIELD), { borderRadius: 10 * g.s, backgroundColor: look.t.pinnedResting, justifyContent: "center", paddingHorizontal: 12 * g.s, overflow: "hidden" }, style as ViewStyle]}>
      {children ?? <Crumb g={g} look={look} t={t} />}
    </Animated.View>
  );
}

export function Card({ g, look, rect, children, style, bg }: { g: Geo; look: Look; rect: Rect; children?: ReactNode; style?: Styles; bg?: string }) {
  return (
    <Animated.View style={[atRect(g, rect), { borderRadius: 10 * g.s, backgroundColor: bg ?? look.page, borderWidth: hairline, borderColor: look.t.cardEdge, overflow: "hidden" }, style as ViewStyle]}>
      {children}
    </Animated.View>
  );
}
