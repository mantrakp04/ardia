import { Surface, Symbol } from "@ardia/shell";
import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Easing, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { hex, nearestPreset, PROFILE_COLORS, themeFor, type Theme } from "../../../lib/theme";
import { backdropTint, opaqueTint, tintForHue } from "../../../lib/windowTint";
import { toolbarPalette, type ToolbarPalette } from "../../layout/toolbarColors";
import type { ProfileColor } from "../../../store/types";

export type Geo = { s: number; W: number; H: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type Anim = Animated.Value | Animated.AnimatedInterpolation<number>;
type Styles = StyleProp<ViewStyle> | object;

export const DESIGN = { width: 860, height: 600 } as const;

export function geo(width: number, height: number): Geo {
  const s = Math.min(width / DESIGN.width, height / DESIGN.height);
  return { s, W: width / s, H: height / s };
}

export const SIDEBAR_W = 190;
export const ROW = { x: 6, w: 178, h: 34, pitch: 37, top: 62, topWithField: 94 } as const;
export const FIELD: Rect = { x: 6, y: 46, w: 178, h: 34 };
export const TOOLBAR_H = 41;
export const CRUMB_X = 153;
export const STRIP_H = 42;
export const CHIP = { x: 76, w: 173, gap: 4, top: 5, h: 32 } as const;
export const LIGHTS_Y = { toolbar: 27, field: 24, strip: 20.75 } as const;
export const rowY = (i: number, top: number = ROW.top) => top + i * ROW.pitch;

export const sideCard = (g: Geo): Rect => ({ x: SIDEBAR_W + 7, y: 6, w: g.W - SIDEBAR_W - 14, h: g.H - 13 });
export const topCard = (g: Geo): Rect => ({ x: 6, y: STRIP_H, w: g.W - 12, h: g.H - STRIP_H - 6 });

export const at = (g: Geo, x: number, y: number, w: number, h: number): ViewStyle => ({ position: "absolute", left: x * g.s, top: y * g.s, width: w * g.s, height: h * g.s });
export const atRect = (g: Geo, r: Rect) => at(g, r.x, r.y, r.w, r.h);
export const hairline = StyleSheet.hairlineWidth;
export const fill = StyleSheet.absoluteFill;

export type Tab = { title: string; host: string; color: string; icon: string };

export const TABS: readonly Tab[] = [
  { title: "Field Notes", host: "fieldnotes.blog", color: "#4E8A5B", icon: "leaf.fill" },
  { title: "Inbox", host: "mail.fastmail.com", color: "#3A7BEA", icon: "envelope.fill" },
  { title: "Weekend in Lisbon", host: "maps.apple.com", color: "#E8664A", icon: "map.fill" },
  { title: "Q4 roadmap", host: "docs.new", color: "#7C6BD6", icon: "doc.text.fill" },
  { title: "Focus mix", host: "music.apple.com", color: "#E0457B", icon: "music.note" },
  { title: "Sourdough, day 2", host: "cooking.nytimes.com", color: "#E3A21A", icon: "fork.knife" },
  { title: "Pull requests", host: "github.com", color: "#24292F", icon: "arrow.triangle.pull" },
];
export const NEW_TAB: Tab = { title: "New Tab", host: "", color: "#8E8E93", icon: "plus" };
export const tab = (i: number) => TABS[i % TABS.length]!;

export type Article = {
  site: string;
  band: readonly [string, string];
  title: string;
  byline: string;
  body: string;
  hero: { sky: readonly [string, string]; sun: readonly [string, string]; far: readonly [string, string]; near: readonly [string, string]; sea: readonly [string, string] };
};

export const NOTES: Article = {
  site: "Field Notes",
  band: ["#E6EEE3", "#1E2722"],
  title: "A slow morning on the coast trail",
  byline: "Mara Lindqvist · 6 min read",
  body: "We left before the fog lifted, coffee in the side pocket, and walked until the cliffs ran out. Nobody else was there, just gulls and the sound of the tide coming back in.",
  hero: { sky: ["#CFE2EC", "#2A3946"], sun: ["#F6D58C", "#CDAE63"], far: ["#A8C8A2", "#3E5A45"], near: ["#7DAA83", "#2F4839"], sea: ["#9CC3D4", "#2D4A59"] },
};

export const TRIP: Article = {
  site: "Wanderlog",
  band: ["#E5ECF6", "#1C2330"],
  title: "Three days in Lisbon",
  byline: "Itinerary · 12 places · shared with 2",
  body: "Day one starts in Alfama with pastéis de nata at the corner bakery, then the 28 tram up to the castle before the crowds arrive.",
  hero: { sky: ["#F4D9C2", "#4A3439"], sun: ["#F2A86A", "#C77F4B"], far: ["#E7B9A0", "#5B4044"], near: ["#C98F7A", "#43303A"], sea: ["#B7CFE0", "#2C3E52"] },
};

export const SITE: readonly [string, string] = NOTES.band;

export type Look = {
  dark: boolean;
  t: Theme;
  tint: readonly [string, string];
  card: string;
  page: string;
  ink: string;
  inkDim: string;
  inkFaint: string;
  site: ToolbarPalette;
  plain: ToolbarPalette;
};

const looks = new Map<string, Look>();

function channels(color: string): [number, number, number, number] {
  const h = hex(color).replace("#", "");
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), h.length >= 8 ? n(6) / 255 : 1];
}

export function over(top: string, under: string): string {
  const [r, g, b, a] = channels(top);
  const [R, G, B] = channels(under);
  const mix = (x: number, y: number) => Math.round(x * a + y * (1 - a)).toString(16).padStart(2, "0");
  return `#${mix(r, R)}${mix(g, G)}${mix(b, B)}`.toUpperCase();
}

export function mixColors(a: string, b: string, t: number): string {
  const [r, g, bl] = channels(a);
  const [R, G, B] = channels(b);
  const m = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, "0");
  return `#${m(r, R)}${m(g, G)}${m(bl, B)}`.toUpperCase();
}

export function lookFor(dark: boolean, accent: string): Look {
  const key = `${dark}|${accent}`;
  const cached = looks.get(key);
  if (cached) return cached;
  const mode = dark ? "dark" : "light";
  const exact = (Object.keys(PROFILE_COLORS) as ProfileColor[]).find((c) => PROFILE_COLORS[c].swatch.toLowerCase() === accent.toLowerCase());
  const t = themeFor(`${exact ?? nearestPreset(accent)}:${mode}`);
  const tint = exact ? t.windowTint : opaqueTint(backdropTint(tintForHue(accent), false), dark);
  const look: Look = {
    dark,
    t,
    tint,
    card: over(t.card, mixColors(tint[0], tint[1], 0.5)),
    page: dark ? "#161718" : "#FFFFFF",
    ink: dark ? "#ECECEE" : "#1D1D1F",
    inkDim: dark ? "rgba(236,236,238,0.62)" : "rgba(29,29,31,0.62)",
    inkFaint: dark ? "rgba(236,236,238,0.4)" : "rgba(29,29,31,0.42)",
    site: toolbarPalette(t, SITE[dark ? 1 : 0]),
    plain: toolbarPalette(t, null),
  };
  looks.set(key, look);
  return look;
}

export const pick = <T,>(look: Look, pair: readonly [T, T]) => pair[look.dark ? 1 : 0];

export type Stop = readonly [number, number];

const SAMPLES = 8;
export const easeOut = (x: number) => 1 - (1 - x) ** 3;
export const linear = (x: number) => x;

export function track(p: Animated.Value, duration: number, stops: readonly Stop[], ease: (x: number) => number = easeOut) {
  const input: number[] = [];
  const output: number[] = [];
  const push = (ms: number, value: number) => {
    const last = input.length ? input[input.length - 1]! * duration : -Infinity;
    input.push(Math.max(ms, last + 0.5) / duration);
    output.push(value);
  };
  stops.forEach(([ms, value], i) => {
    if (i === 0) return push(ms, value);
    const [from, start] = stops[i - 1]!;
    if (value === start) return push(ms, value);
    for (let k = 1; k <= SAMPLES; k++) push(from + ((ms - from) * k) / SAMPLES, start + (value - start) * ease(k / SAMPLES));
  });
  if (input.length === 1) push(input[0]! * duration + 1, output[0]!);
  return p.interpolate({ inputRange: input, outputRange: output, extrapolate: "clamp" });
}

export type Tracker = ReturnType<typeof tracker>;

export function tracker(p: Animated.Value, duration: number) {
  const t = (stops: readonly Stop[], ease?: (x: number) => number) => track(p, duration, stops, ease);
  t.in = (ms: number, dur = 240) => track(p, duration, [[ms, 0], [ms + dur, 1]]);
  t.out = (ms: number, dur = 240) => track(p, duration, [[ms, 1], [ms + dur, 0]]);
  t.step = (ms: number, from = 0, to = 1) => track(p, duration, [[ms, from], [ms + 1, to]], linear);
  t.deg = (stops: readonly Stop[]) => track(p, duration, stops).interpolate({ inputRange: [0, 360], outputRange: ["0deg", "360deg"], extrapolate: "extend" });
  return t;
}

export function useDemo(active: boolean, duration: number) {
  const p = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!active) return;
    p.setValue(0);
    const run = Animated.timing(p, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: true, isInteraction: false });
    run.start();
    return () => {
      run.stop();
      p.setValue(1);
    };
  }, [active, duration]);
  return p;
}

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

export const LIGHT_COLORS = ["#FF5F57", "#FEBC2E", "#28C840"] as const;

export function Lights({ g, y = LIGHTS_Y.toolbar, x = 25, style }: { g: Geo; y?: number; x?: number; style?: Styles }) {
  return (
    <Animated.View style={[at(g, x - 6, y - 6, 52, 12), style as ViewStyle]} pointerEvents="none">
      {LIGHT_COLORS.map((color, i) => (
        <View key={color} style={[at(g, i * 20, 0, 12, 12), { borderRadius: 6 * g.s, backgroundColor: color, borderWidth: hairline, borderColor: "rgba(0,0,0,0.14)" }]} />
      ))}
    </Animated.View>
  );
}

export function Favicon({ g, t, size = 16 }: { g: Geo; t: Tab; size?: number }) {
  if (t === NEW_TAB) return <View style={{ width: size * g.s, height: size * g.s, alignItems: "center", justifyContent: "center" }}><Glyph g={g} name="plus" size={size * 0.8} color="#8E8E93" box={size} /></View>;
  return (
    <View style={{ width: size * g.s, height: size * g.s, borderRadius: size * 0.25 * g.s, backgroundColor: t.color, alignItems: "center", justifyContent: "center" }}>
      <Glyph g={g} name={t.icon} size={size * 0.58} color="#FFFFFF" weight="semibold" box={size} />
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

export const TOOLBAR_ICONS = [21, 56, 92, 127] as const;
export const SIDEBAR_ICONS = [98, 133, 168] as const;

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

export function Hero({ g, look, a, height }: { g: Geo; look: Look; a: Article; height: number }) {
  const h = a.hero;
  return (
    <View style={{ height: height * g.s, borderRadius: 12 * g.s, overflow: "hidden", backgroundColor: pick(look, h.sky) }}>
      <View style={{ position: "absolute", right: "18%", top: height * 0.16 * g.s, width: height * 0.26 * g.s, height: height * 0.26 * g.s, borderRadius: height * 0.13 * g.s, backgroundColor: pick(look, h.sun) }} />
      <View style={{ position: "absolute", left: "-20%", width: "90%", top: height * 0.42 * g.s, height: height * 1.4 * g.s, borderRadius: height * 0.9 * g.s, backgroundColor: pick(look, h.far) }} />
      <View style={{ position: "absolute", left: "35%", width: "95%", top: height * 0.52 * g.s, height: height * 1.4 * g.s, borderRadius: height * 0.9 * g.s, backgroundColor: pick(look, h.near) }} />
      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: height * 0.2 * g.s, backgroundColor: pick(look, h.sea) }} />
    </View>
  );
}

export function Page({ g, look, a = NOTES, top = 0, children }: { g: Geo; look: Look; a?: Article; top?: number; children?: ReactNode }) {
  return (
    <View style={[fill, { top: top * g.s, backgroundColor: look.page }]} pointerEvents="none">
      <View style={{ height: 58 * g.s, backgroundColor: pick(look, a.band), flexDirection: "row", alignItems: "center", paddingHorizontal: 36 * g.s, justifyContent: "space-between" }}>
        <Label g={g} size={19} color={look.ink} weight="700" family="Georgia">
          {a.site}
        </Label>
        <View style={{ flexDirection: "row", gap: 18 * g.s }}>
          {["Journal", "Maps", "About"].map((n) => (
            <Label key={n} g={g} size={11.5} color={look.inkDim}>
              {n}
            </Label>
          ))}
        </View>
      </View>
      <View style={{ alignSelf: "center", width: "84%", maxWidth: 600 * g.s, paddingTop: 22 * g.s, gap: 12 * g.s }}>
        <Hero g={g} look={look} a={a} height={168} />
        <View style={{ gap: 4 * g.s }}>
          <Label g={g} size={23} color={look.ink} weight="700" family="Georgia" lines={2}>
            {a.title}
          </Label>
          <Label g={g} size={11.5} color={look.inkFaint}>
            {a.byline}
          </Label>
        </View>
        <Label g={g} size={12.5} color={look.inkDim} lines={4} style={{ lineHeight: 19 * g.s }}>
          {a.body}
        </Label>
        {children}
      </View>
    </View>
  );
}

export function NewTabPage({ g, look, top = 0, width }: { g: Geo; look: Look; top?: number; width: number }) {
  const barW = Math.min(520, width - 60);
  return (
    <View style={[fill, { top: top * g.s, alignItems: "center", backgroundColor: look.card }]} pointerEvents="none">
      <View style={{ marginTop: 120 * g.s, width: barW * g.s, height: 43 * g.s, borderRadius: 14 * g.s, backgroundColor: look.t.ntpBarSolid, borderWidth: hairline, borderColor: look.t.ntpBarBorder, flexDirection: "row", alignItems: "center", paddingHorizontal: 14 * g.s, gap: 9 * g.s }}>
        <Glyph g={g} name="magnifyingglass" size={14} color={look.t.textSecondary} weight="medium" box={18} />
        <Label g={g} size={15} color={look.t.placeholder}>
          Search or enter address
        </Label>
      </View>
      <View style={{ flexDirection: "row", gap: 16 * g.s, marginTop: 30 * g.s }}>
        {TABS.slice(0, 6).map((t) => (
          <View key={t.title} style={{ alignItems: "center", gap: 6 * g.s }}>
            <View style={{ width: 46 * g.s, height: 46 * g.s, borderRadius: 12 * g.s, backgroundColor: look.t.pinnedResting, alignItems: "center", justifyContent: "center" }}>
              <Favicon g={g} t={t} size={22} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

export function Panel({ g, look, rect, radius = 17, children, style }: { g: Geo; look: Look; rect: Rect; radius?: number; children?: ReactNode; style?: Styles }) {
  return (
    <Animated.View style={[atRect(g, rect), style as ViewStyle]}>
      <Surface
        fill={hex(look.t.panel)}
        cornerRadius={radius * g.s}
        borderColor={hex(look.t.panelBorder)}
        borderWidth={0.5}
        shadowColor="#000000"
        shadowOpacity={look.t.panelShadowOpacity}
        shadowRadius={24 * g.s}
        shadowOffset={[0, 10 * g.s]}
        style={fill}
      />
      <View style={[fill, { borderRadius: radius * g.s, overflow: "hidden" }]}>{children}</View>
    </Animated.View>
  );
}

export type Suggestion = { icon?: string; fav?: Tab; title: string; detail?: string; hint?: string };

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
        shadowColor="#000000"
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
        <Glyph g={g} name="cursorarrow" size={15} color="#FFFFFF" weight="bold" box={18} />
      </View>
      <Glyph g={g} name="cursorarrow" size={15} color="#111111" weight="regular" box={18} />
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
        shadowColor="#000000"
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
