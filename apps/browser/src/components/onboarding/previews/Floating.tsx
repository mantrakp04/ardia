import type { ReactNode } from "react";
import { Animated, Text, View, type ViewStyle } from "react-native";
import { Surface } from "../../ui";
import { hex } from "../../ui/theme";
import { ink } from "../../ui/tokens";
import type { Suggestion } from "./content";
import { at, atRect, fill, type Geo, type Rect } from "./geometry";
import { Favicon, Glyph, Label, type Styles } from "./Kit";
import type { Look } from "./look";
import { mockInk } from "./tokens";

export function Panel({ g, look, rect, radius = 17, children, style }: { g: Geo; look: Look; rect: Rect; radius?: number; children?: ReactNode; style?: Styles }) {
  return (
    <Animated.View style={[atRect(g, rect), style as ViewStyle]}>
      <Surface
        fill={hex(look.t.panel)}
        cornerRadius={radius * g.s}
        borderColor={hex(look.t.panelBorder)}
        borderWidth={0.5}
        shadowColor={ink.black}
        shadowOpacity={look.t.panelShadowOpacity}
        shadowRadius={24 * g.s}
        shadowOffset={[0, 10 * g.s]}
        style={fill}
      />
      <View style={[fill, { borderRadius: radius * g.s, overflow: "hidden" }]}>{children}</View>
    </Animated.View>
  );
}

export function SuggestionRow({ g, look, s, selected, style }: { g: Geo; look: Look; s: Suggestion; selected?: boolean; style?: Styles }) {
  return (
    <Animated.View
      style={[
        { height: 35 * g.s, borderRadius: 11 * g.s, paddingHorizontal: 13 * g.s, flexDirection: "row", alignItems: "center", gap: 10 * g.s, backgroundColor: selected ? look.t.commandBarSelected : "transparent" },
        style as ViewStyle,
      ]}
    >
      {s.fav ? <Favicon g={g} t={s.fav} /> : <Glyph g={g} name={s.icon ?? "magnifyingglass"} size={13} color={look.t.textSecondary} weight="medium" box={16} />}
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center" }}>
        <Label g={g} size={14} color={look.t.textPrimary}>
          {s.title}
          {s.detail ? <Text style={{ color: look.t.textTertiary }}>{`  ${s.detail}`}</Text> : null}
        </Label>
      </View>
      {s.hint ? (
        <Label g={g} size={12} color={look.t.textTertiary}>
          {s.hint}
        </Label>
      ) : null}
    </Animated.View>
  );
}

export function InputRow({ g, look, children, height = 52 }: { g: Geo; look: Look; children?: ReactNode; height?: number }) {
  return (
    <View style={{ height: height * g.s, flexDirection: "row", alignItems: "center", paddingLeft: 15 * g.s, paddingRight: 12 * g.s, gap: 10 * g.s }}>
      <Glyph g={g} name="magnifyingglass" size={15} color={look.t.textPrimary} weight="medium" box={18} />
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center" }}>{children}</View>
    </View>
  );
}

export function Keycap({ g, look, x, y, label, style }: { g: Geo; look: Look; x: number; y: number; label: string; style?: Styles }) {
  return (
    <Animated.View style={[{ position: "absolute", right: (g.W - x) * g.s, top: y * g.s }, style as ViewStyle]} pointerEvents="none">
      <Surface
        fill={hex(look.t.panel)}
        cornerRadius={9 * g.s}
        borderColor={hex(look.t.panelBorder)}
        borderWidth={0.5}
        shadowColor={ink.black}
        shadowOpacity={look.dark ? 0.5 : 0.16}
        shadowRadius={10 * g.s}
        shadowOffset={[0, 3 * g.s]}
        style={{ paddingHorizontal: 11 * g.s, height: 30 * g.s, justifyContent: "center" }}
      >
        <Label g={g} size={14} color={look.t.textPrimary} weight="600">
          {label}
        </Label>
      </Surface>
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

export function Pill({ g, look, children, style }: { g: Geo; look: Look; children: ReactNode; style?: Styles }) {
  return (
    <Animated.View style={[{ position: "absolute" }, style as ViewStyle]} pointerEvents="none">
      <Surface
        fill={hex(look.t.panel)}
        cornerRadius={16 * g.s}
        borderColor={hex(look.t.panelBorder)}
        borderWidth={0.5}
        shadowColor={ink.black}
        shadowOpacity={look.dark ? 0.45 : 0.14}
        shadowRadius={14 * g.s}
        shadowOffset={[0, 4 * g.s]}
        style={{ height: 32 * g.s, paddingHorizontal: 12 * g.s, flexDirection: "row", alignItems: "center", gap: 7 * g.s }}
      >
        {children}
      </Surface>
    </Animated.View>
  );
}
