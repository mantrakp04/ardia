import { useEffect, useMemo, useRef } from "react";
import { Animated, View } from "react-native";
import { GlassLookContext, liquidGlass } from "../../ui/Glass";
import { Panel } from "../../ui/Panel";
import { ThemeContext, layout, useTheme } from "../../ui/theme";
import { font, radius, space } from "../../ui/tokens";
import { curve } from "../../ui/motion";
import { RestingTile } from "../../sidebar/TileFace";
import { SidebarFieldFill } from "../../sidebar/SidebarField";
import { useBasePaletteValue } from "../../../state/config/hooks";
import { DEFAULT_SETTINGS, type Settings } from "../../../state/settings/settings";
import { windowCornerRadius } from "../../../state/windows/layout";
import { NOTES, tab } from "./content";
import { fill, type Geo } from "./geometry";
import { Favicon, Glyph, Label, Lights, WindowFrame } from "./Kit";
import { lookFor, pick, type Look } from "./look";
import { mockInk } from "./tokens";

export const STAGE = { width: 404, height: 282 } as const;
const NATIVE: Geo = { s: 1, W: STAGE.width, H: STAGE.height };
const SIDE = { x: 12, w: 196, lightsY: 20 } as const;
const TILES = { top: 40, gap: space.s, count: 3 } as const;
const TILE_W = (SIDE.w - TILES.gap * (TILES.count - 1)) / TILES.count;
const FIELD_TOP = TILES.top + layout.pinnedHeight + space.l;
const ROWS_TOP = FIELD_TOP + layout.rowHeight + space.l;
const ROW_PITCH = 30;
const BAR = { x: 222, y: 128, w: 170, radius: radius.sheet, rowH: 30 } as const;
const PAN = { ms: 6000 } as const;
const SUN = { size: 84, y: 34, from: -10, to: 330 } as const;

export type StyleChoice = { glass: boolean; tint: number };

export function styleChoiceOf(settings: Partial<Settings>, hovered: Settings["interfaceStyle"] | null): StyleChoice {
  const style = hovered ?? settings.interfaceStyle ?? DEFAULT_SETTINGS.interfaceStyle;
  const tinted = settings.glassTintWithTheme ?? DEFAULT_SETTINGS.glassTintWithTheme;
  return { glass: style === "glass", tint: tinted ? (settings.glassTintAmount ?? DEFAULT_SETTINGS.glassTintAmount) : 0 };
}

function usePan() {
  const pan = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const leg = (toValue: number) => Animated.timing(pan, { toValue, duration: PAN.ms, easing: curve.pulse, useNativeDriver: true, isInteraction: false });
    const loop = Animated.loop(Animated.sequence([leg(1), leg(0)]));
    loop.start();
    return () => loop.stop();
  }, [pan]);
  return pan;
}

function Landscape({ look }: { look: Look }) {
  const pan = usePan();
  const h = NOTES.hero;
  const hill = (color: string, left: number, top: number, width: number) => (
    <View style={{ position: "absolute", left, top, width, height: width, borderRadius: width / 2, backgroundColor: color }} />
  );
  return (
    <View pointerEvents="none" style={[fill, { backgroundColor: pick(look, h.sky) }]}>
      <Animated.View
        style={{
          position: "absolute",
          left: 0,
          top: SUN.y,
          width: SUN.size,
          height: SUN.size,
          borderRadius: SUN.size / 2,
          backgroundColor: pick(look, h.sun),
          transform: [{ translateX: pan.interpolate({ inputRange: [0, 1], outputRange: [SUN.from, SUN.to] }) }],
        }}
      />
      {hill(pick(look, h.far), -160, 150, 420)}
      {hill(pick(look, h.near), 150, 175, 460)}
      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 44, backgroundColor: pick(look, h.sea) }} />
    </View>
  );
}

function Sidebar() {
  const t = useTheme();
  return (
    <>
      <Lights g={NATIVE} x={SIDE.x + 7} y={SIDE.lightsY} />
      <View style={{ position: "absolute", left: SIDE.x, top: TILES.top, flexDirection: "row", gap: TILES.gap }}>
        {Array.from({ length: TILES.count }, (_, i) => (
          <RestingTile key={i} width={TILE_W} selected={false} hovered={i === 0} pressed={false}>
            <Favicon g={NATIVE} t={tab(i + 1)} size={18} />
          </RestingTile>
        ))}
      </View>
      <View style={{ position: "absolute", left: SIDE.x, top: FIELD_TOP, width: SIDE.w, height: layout.rowHeight, flexDirection: "row", alignItems: "center", gap: space.s, paddingHorizontal: space.ml }}>
        <SidebarFieldFill hovered={false} />
        <Favicon g={NATIVE} t={tab(0)} size={14} />
        <Label g={NATIVE} size={font.body.fontSize} color={t.textPrimary} weight="500">
          {tab(0).host}
        </Label>
      </View>
      {[4, 5].map((n, i) => (
        <View key={n} style={{ position: "absolute", left: SIDE.x + space.ml, top: ROWS_TOP + i * ROW_PITCH, width: SIDE.w - space.ml * 2, flexDirection: "row", alignItems: "center", gap: space.s }}>
          <Favicon g={NATIVE} t={tab(n)} size={14} />
          <Label g={NATIVE} size={font.body.fontSize} color={t.textPrimary}>
            {tab(n).title}
          </Label>
        </View>
      ))}
    </>
  );
}

function CommandBar() {
  const t = useTheme();
  const rows = [tab(2), tab(3)];
  return (
    <Panel glass radius={BAR.radius} style={{ position: "absolute", left: BAR.x, top: BAR.y, width: BAR.w, paddingVertical: space.s }}>
      <View style={{ height: BAR.rowH, flexDirection: "row", alignItems: "center", gap: space.s, paddingHorizontal: space.ml }}>
        <Glyph g={NATIVE} name="magnifyingglass" size={12} color={t.textSecondary} weight="medium" box={14} />
        <Label g={NATIVE} size={font.body.fontSize} color={t.textSecondary}>
          Search or go to…
        </Label>
      </View>
      {rows.map((r) => (
        <View key={r.title} style={{ height: BAR.rowH, flexDirection: "row", alignItems: "center", gap: space.s, paddingHorizontal: space.ml }}>
          <Favicon g={NATIVE} t={r} size={14} />
          <Label g={NATIVE} size={font.body.fontSize} color={t.textPrimary}>
            {r.title}
          </Label>
        </View>
      ))}
    </Panel>
  );
}

export function StyleStage({ look, choice }: { look: Look; choice: StyleChoice }) {
  const glassLook = useMemo(() => ({ controls: liquidGlass && choice.glass, panes: liquidGlass && choice.glass, tint: choice.tint }), [choice.glass, choice.tint]);
  return (
    <ThemeContext.Provider value={look.t}>
      <GlassLookContext.Provider value={glassLook}>
        <View style={{ width: STAGE.width, height: STAGE.height, overflow: "hidden" }}>
          <Landscape look={look} />
          <Sidebar />
          <CommandBar />
        </View>
      </GlassLookContext.Provider>
    </ThemeContext.Provider>
  );
}

export function StylePreview({ settings, accent, hovered }: { settings: Partial<Settings>; accent: string; hovered: Settings["interfaceStyle"] | null }) {
  const systemDark = useTheme().dark;
  const appearance = settings.appearance ?? DEFAULT_SETTINGS.appearance;
  const dark = appearance === "dark" || (appearance === "auto" && systemDark);
  const look = lookFor(dark, accent, useBasePaletteValue());
  const choice = styleChoiceOf(settings, hovered);
  return (
    <WindowFrame g={NATIVE} look={look} edge={pick(look, [mockInk.windowEdge.light, mockInk.windowEdge.dark])} cornerRadius={windowCornerRadius()} style={{ width: STAGE.width, height: STAGE.height }}>
      <View style={fill}>
        <StyleStage look={look} choice={choice} />
      </View>
    </WindowFrame>
  );
}
