import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { GlassFill, GlassLookContext, liquidGlass, type GlassState } from "../../ui/Glass";
import { ThemeContext, useTheme } from "../../ui/theme";
import { capsule, font, space } from "../../ui/tokens";
import { curve } from "../../ui/motion";
import { mix } from "../../../lib/color";
import { useBasePaletteValue } from "../../../state/config/hooks";
import { DEFAULT_SETTINGS, type Settings } from "../../../state/settings/settings";
import { windowCornerRadius } from "../../../state/windows/layout";
import { tab } from "./content";
import { fill, type Geo } from "./geometry";
import { Favicon, Glyph, Label, Lights, WindowFrame } from "./Kit";
import { lookFor, pick, type Look } from "./look";
import { mockInk, styleScene, styleSceneMs, styleStage } from "./tokens";

export const STAGE = { width: 420, height: 380 } as const;
const NATIVE: Geo = { s: 1, W: STAGE.width, H: STAGE.height };
const PAD = 22;
const INNER_W = STAGE.width - PAD * 2;
const { tiles: TILES, field: FIELD, buttons: BUTTONS } = styleStage;
const TILE_W = (INNER_W - TILES.gap * (TILES.count - 1)) / TILES.count;
const SUN = { size: 72, from: -90, to: STAGE.width + 18 } as const;
const SUN_TOP = TILES.top + (TILES.h - SUN.size) / 2;
const PILL_X = PAD + 3 * (BUTTONS.size + BUTTONS.gap);
const ICONS = { favicon: 20, button: 17, buttonBox: 22, plus: 15, plusBox: 20 } as const;
const SKY_BANDS = 12;
const HILLS = { far: { left: 150, top: 196, size: 560 }, near: { left: -240, top: 262, size: 520 } } as const;
const SEA_H = 62;
const GLINT_H = 3;
const GLINTS = [
  { x: 40, y: 18, w: 90 },
  { x: 190, y: 34, w: 140 },
  { x: 300, y: 12, w: 70 },
] as const;

export type StyleChoice = { glass: boolean; tint: number };

export function styleChoiceOf(settings: Partial<Settings>, hovered: Settings["interfaceStyle"] | null): StyleChoice {
  const style = hovered ?? settings.interfaceStyle ?? DEFAULT_SETTINGS.interfaceStyle;
  const tinted = settings.glassTintWithTheme ?? DEFAULT_SETTINGS.glassTintWithTheme;
  return { glass: style === "glass", tint: tinted ? (settings.glassTintAmount ?? DEFAULT_SETTINGS.glassTintAmount) : 0 };
}

function useSunTravel() {
  const travel = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const leg = (toValue: number) => Animated.timing(travel, { toValue, duration: styleSceneMs.sunLeg, easing: curve.pulse, useNativeDriver: true, isInteraction: false });
    const loop = Animated.loop(Animated.sequence([leg(1), leg(0)]));
    loop.start();
    return () => loop.stop();
  }, [travel]);
  return travel;
}

function Scene({ dark }: { dark: boolean }) {
  const ink = dark ? styleScene.dark : styleScene.light;
  const travel = useSunTravel();
  const hill = (color: string, h: { left: number; top: number; size: number }) => (
    <View style={{ position: "absolute", left: h.left, top: h.top, width: h.size, height: h.size, borderRadius: h.size / 2, backgroundColor: color }} />
  );
  return (
    <View pointerEvents="none" style={[fill, { backgroundColor: ink.skyTop }]}>
      {Array.from({ length: SKY_BANDS - 1 }, (_, i) => (
        <View key={i} style={{ position: "absolute", left: 0, right: 0, top: ((i + 1) / SKY_BANDS) * (STAGE.height - SEA_H), bottom: 0, backgroundColor: mix(ink.skyTop, ink.skyBottom, (i + 1) / (SKY_BANDS - 1)) }} />
      ))}
      <Animated.View
        style={{
          position: "absolute",
          left: 0,
          top: SUN_TOP,
          width: SUN.size,
          height: SUN.size,
          borderRadius: SUN.size / 2,
          backgroundColor: ink.sun,
          transform: [{ translateX: travel.interpolate({ inputRange: [0, 1], outputRange: [SUN.from, SUN.to] }) }],
        }}
      />
      {hill(ink.far, HILLS.far)}
      {hill(ink.near, HILLS.near)}
      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: SEA_H, backgroundColor: ink.sea }}>
        {GLINTS.map((g) => (
          <View key={g.x} style={{ position: "absolute", left: g.x, top: g.y, width: g.w, height: GLINT_H, borderRadius: capsule(GLINT_H), backgroundColor: ink.glint }} />
        ))}
      </View>
    </View>
  );
}

function Face({ glass, look, radius, state = "rest", children }: { glass: boolean; look: Look; radius: number; state?: GlassState; children?: ReactNode }) {
  const t = look.t;
  return (
    <View style={[fill, { borderRadius: radius, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.s }]}>
      {glass ? (
        <GlassFill radius={radius} state={state} />
      ) : (
        <View pointerEvents="none" style={[fill, { borderRadius: radius, backgroundColor: look.card }]}>
          <View style={[fill, { borderRadius: radius, borderWidth: StyleSheet.hairlineWidth, borderColor: t.pinnedRestingStroke, backgroundColor: state === "rest" ? t.pinnedResting : t.tabHover }]} />
        </View>
      )}
      {children}
    </View>
  );
}

const at = (left: number, top: number, width: number, height: number) => ({ position: "absolute" as const, left, top, width, height });

function Surfaces({ look, glass }: { look: Look; glass: boolean }) {
  const t = look.t;
  return (
    <>
      <Lights g={NATIVE} x={PAD + 7} y={24} />
      {Array.from({ length: TILES.count }, (_, i) => (
        <View key={i} style={at(PAD + i * (TILE_W + TILES.gap), TILES.top, TILE_W, TILES.h)}>
          <Face glass={glass} look={look} radius={TILES.radius} >
            <Favicon g={NATIVE} t={tab(i + 1)} size={TILES.icon} />
          </Face>
        </View>
      ))}
      <View style={at(PAD, FIELD.top, INNER_W, FIELD.h)}>
        <Face glass={glass} look={look} radius={FIELD.radius}>
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: space.m, paddingHorizontal: space.l }}>
            <Favicon g={NATIVE} t={tab(0)} size={ICONS.favicon} />
            <Label g={NATIVE} size={font.large.fontSize} color={t.textPrimary} weight="600">
              {tab(0).host}
            </Label>
          </View>
        </Face>
      </View>
      {(["chevron.left", "chevron.right", "arrow.clockwise"] as const).map((name, i) => (
        <View key={name} style={at(PAD + i * (BUTTONS.size + BUTTONS.gap), BUTTONS.top, BUTTONS.size, BUTTONS.size)}>
          <Face glass={glass} look={look} radius={capsule(BUTTONS.size)}>
            <Glyph g={NATIVE} name={name} size={ICONS.button} color={t.textPrimary} weight="semibold" box={ICONS.buttonBox} />
          </Face>
        </View>
      ))}
      <View style={at(PILL_X, BUTTONS.top, STAGE.width - PAD - PILL_X, BUTTONS.size)}>
        <Face glass={glass} look={look} radius={capsule(BUTTONS.size)}>
          <Glyph g={NATIVE} name="plus" size={ICONS.plus} color={t.textPrimary} weight="semibold" box={ICONS.plusBox} />
          <Label g={NATIVE} size={font.large.fontSize} color={t.textPrimary} weight="600">
            New Tab
          </Label>
        </Face>
      </View>
    </>
  );
}

export function StyleStage({ look, choice }: { look: Look; choice: StyleChoice }) {
  const glass = liquidGlass && choice.glass;
  const glassLook = useMemo(() => ({ controls: glass, panes: glass, tint: choice.tint }), [glass, choice.tint]);
  return (
    <ThemeContext.Provider value={look.t}>
      <GlassLookContext.Provider value={glassLook}>
        <View style={{ width: STAGE.width, height: STAGE.height, overflow: "hidden" }}>
          <Scene dark={look.dark} />
          <Surfaces look={look} glass={glass} />
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
  return (
    <WindowFrame g={NATIVE} look={look} edge={pick(look, [mockInk.windowEdge.light, mockInk.windowEdge.dark])} cornerRadius={windowCornerRadius()} style={{ width: STAGE.width, height: STAGE.height }}>
      <StyleStage look={look} choice={styleChoiceOf(settings, hovered)} />
    </WindowFrame>
  );
}
