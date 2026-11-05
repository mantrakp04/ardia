import type { ReactNode } from "react";
import { Animated, Text, View, type ViewStyle } from "react-native";
import { KeyCap } from "../../ui/KeyCap";
import { capsule, font, radius as radii, shadow, space } from "../../ui/tokens";
import { SUGGESTION } from "../../omnibox/tokens";
import type { Suggestion } from "./content";
import { at, atRect, fill, type Geo, type Rect } from "./geometry";
import { Favicon, Glyph, Label, MockSurface, type Styles } from "./Kit";
import type { Look } from "./look";
import { mockInk } from "./tokens";

const PILL_HEIGHT = 32;

export function Panel({ g, look, rect, radius = radii.hero, children, style }: { g: Geo; look: Look; rect: Rect; radius?: number; children?: ReactNode; style?: Styles }) {
  return (
    <Animated.View style={[atRect(g, rect), style as ViewStyle]}>
      <MockSurface g={g} look={look} radius={radius} shadow={shadow.dialog} style={fill} />
      <View style={[fill, { borderRadius: radius * g.s, overflow: "hidden" }]}>{children}</View>
    </Animated.View>
  );
}

export function SuggestionRow({ g, look, s, selected, style }: { g: Geo; look: Look; s: Suggestion; selected?: boolean; style?: Styles }) {
  return (
    <Animated.View
      style={[
        {
          height: SUGGESTION.height * g.s,
          borderRadius: radii.tile * g.s,
          paddingHorizontal: SUGGESTION.padX * g.s,
          flexDirection: "row",
          alignItems: "center",
          gap: SUGGESTION.gap * g.s,
          backgroundColor: selected ? look.t.commandBarSelected : "transparent",
        },
        style as ViewStyle,
      ]}
    >
      {s.fav ? <Favicon g={g} t={s.fav} /> : <Glyph g={g} name={s.icon ?? "magnifyingglass"} size={SUGGESTION.icon} color={look.t.textSecondary} weight="medium" box={SUGGESTION.iconBox} />}
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center" }}>
        <Label g={g} size={font.title.fontSize} color={look.t.textPrimary}>
          {s.title}
          {s.detail ? <Text style={{ color: look.t.textTertiary }}>{`  ${s.detail}`}</Text> : null}
        </Label>
      </View>
      {s.hint ? (
        <Label g={g} size={font.small.fontSize} color={look.t.textTertiary}>
          {s.hint}
        </Label>
      ) : null}
    </Animated.View>
  );
}

export function InputRow({ g, look, children, height = 52 }: { g: Geo; look: Look; children?: ReactNode; height?: number }) {
  return (
    <View style={{ height: height * g.s, flexDirection: "row", alignItems: "center", paddingLeft: space.xl * g.s, paddingRight: space.l * g.s, gap: space.ml * g.s }}>
      <Glyph g={g} name="magnifyingglass" size={15} color={look.t.textPrimary} weight="medium" box={18} />
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center" }}>{children}</View>
    </View>
  );
}

export function Keycap({ g, x, y, label, style }: { g: Geo; x: number; y: number; label: string; style?: Styles }) {
  return (
    <Animated.View style={[{ position: "absolute", right: (g.W - x) * g.s, top: y * g.s }, style as ViewStyle]} pointerEvents="none">
      <KeyCap keys={[label]} scale={g.s} />
    </Animated.View>
  );
}

export function Cursor({ g, style }: { g: Geo; style?: Styles }) {
  return (
    <Animated.View style={[at(g, 0, 0, 18, 18), style as ViewStyle]} pointerEvents="none">
      <View style={{ position: "absolute", left: 0.8 * g.s, top: 0.8 * g.s }}>
        <Glyph g={g} name="cursorarrow" size={15} color={mockInk.cursorRim} weight="bold" box={18} />
      </View>
      <Glyph g={g} name="cursorarrow" size={15} color={mockInk.cursor} weight="regular" box={18} />
    </Animated.View>
  );
}

export function Pill({ g, look, place, children, style }: { g: Geo; look: Look; place?: ViewStyle; children: ReactNode; style?: Styles }) {
  const corner = place ?? { left: space.xl * g.s, bottom: space.xl * g.s };
  return (
    <Animated.View style={[{ position: "absolute" }, corner, style as ViewStyle]} pointerEvents="none">
      <MockSurface
        g={g}
        look={look}
        radius={capsule(PILL_HEIGHT)}
        shadow={shadow.popover}
        style={{ height: PILL_HEIGHT * g.s, paddingHorizontal: space.l * g.s, flexDirection: "row", alignItems: "center", gap: space.m * g.s }}
      >
        {children}
      </MockSurface>
    </Animated.View>
  );
}
