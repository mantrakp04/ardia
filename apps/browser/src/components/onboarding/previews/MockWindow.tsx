import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Animated, View, type LayoutChangeEvent } from "react-native";
import { useTheme } from "../../ui/theme";
import { ThemeBackdrop } from "../../settings/ThemeControls";
import { resolveTheme } from "../../../lib/profileLook";
import type { ProfileTheme } from "../../../state/browser/types";
import { font } from "../../ui/tokens";
import { DEFAULT_SETTINGS, type Settings } from "../../../state/settings/settings";
import type { PreviewId } from "../../../state/onboarding/previewIds";
import { tab } from "./content";
import { DEMOS } from "./demos";
import { Pill } from "./Floating";
import { CARD, CHIP, CRUMB_X, FIELD, fill, geo, LIGHTS_Y, ROW, SIDE_CARD_X, SIDEBAR_ICONS, STRIP_H, TOOLBAR_H, TOOLBAR_ICONS, type Geo } from "./geometry";
import { Backdrop, Card, Crumb, FieldPlate, Glyph, Label, Lights, NavIcons, Rows, TabRow, ToolbarBand, TopTabPlate, WindowFrame } from "./Kit";
import { lookFor, type Look } from "./look";
import { useBasePaletteValue } from "../../../state/config/hooks";
import { Page } from "./MockPages";
import type { SceneOpts } from "./scene";
import { tracker, useDemo } from "./timeline";
import { MockSwitcher } from "./Switcher";
import { mockInk, mockMotion, sceneMs } from "./tokens";

const INSET = { x: 8, top: 5, bottom: 13 };

type Shape = { top: boolean; addressInSidebar: boolean; appearance: Settings["appearance"]; siteColor: boolean };

function shapeOf(settings: Partial<Settings>): Shape {
  const top = (settings.tabLayout ?? DEFAULT_SETTINGS.tabLayout) === "top";
  return {
    top,
    addressInSidebar: !top && (settings.addressBar ?? DEFAULT_SETTINGS.addressBar) === "sidebar",
    appearance: settings.appearance ?? DEFAULT_SETTINGS.appearance,
    siteColor: settings.extendWebsiteColor ?? DEFAULT_SETTINGS.extendWebsiteColor,
  };
}

function useTo(value: number, native: boolean, config: { duration: number; easing: (value: number) => number } = mockMotion.move) {
  const v = useRef(new Animated.Value(value)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const run = Animated.timing(v, { toValue: value, ...config, useNativeDriver: native, isInteraction: false });
    run.start();
    return () => run.stop();
  }, [value]);
  return v;
}

function useFadeBetween<T>(value: T) {
  const [layers, setLayers] = useState<{ below: T | null; above: T }>({ below: null, above: value });
  const fade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (value === layers.above) return;
    setLayers({ below: layers.above, above: value });
    fade.setValue(0);
    const run = Animated.timing(fade, { toValue: 1, ...mockMotion.fade, useNativeDriver: true, isInteraction: false });
    run.start(({ finished }) => finished && setLayers({ below: null, above: value }));
    return () => run.stop();
  }, [value]);
  return { layers, fade };
}

type MockWindowProps = { settings: Partial<Settings>; accent: string; theme?: ProfileTheme | null; focus: PreviewId | null; switcher?: boolean };

export function MockWindow({ settings, accent, theme = null, focus, switcher = false }: MockWindowProps) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0 && (width !== size?.width || height !== size?.height)) setSize({ width, height });
  };
  return (
    <View style={{ flex: 1, alignSelf: "stretch" }} onLayout={onLayout}>
      {size ? <Window width={size.width} height={size.height} settings={settings} accent={accent} theme={theme} focus={focus} switcher={switcher} /> : null}
    </View>
  );
}

function Window({ width, height, settings, accent, theme: custom, focus, switcher }: MockWindowProps & { width: number; height: number; switcher: boolean }) {
  const inner = { w: width - INSET.x * 2, h: height - INSET.top - INSET.bottom };
  const g = useMemo(() => geo(inner.w, inner.h), [inner.w, inner.h]);
  const shape = shapeOf(settings);
  const systemDark = useTheme().dark;
  const dark = shape.appearance === "dark" || (shape.appearance === "auto" && systemDark);
  const lay = useTo(shape.top ? 1 : 0, false);
  const addr = useTo(shape.addressInSidebar ? 1 : 0, false);
  const site = useTo(shape.siteColor ? 1 : 0, true, mockMotion.fade);
  const icons = useTo(settings.profileSwitcherIcons ? 1 : 0, true, mockMotion.fade);
  const theme = useFadeBetween(dark);
  const focusShown = useTo(focus ? 1 : 0, true, mockMotion.focus);
  const [demo, setDemo] = useState(focus);
  useEffect(() => {
    if (focus) return setDemo(focus);
    const timer = setTimeout(() => setDemo(null), 240);
    return () => clearTimeout(timer);
  }, [focus]);
  const palette = useBasePaletteValue();
  const look = lookFor(dark, accent, palette);
  const opts = useMemo<SceneOpts>(() => ({ addressInSidebar: shape.addressInSidebar, systemDark, accent, palette }), [shape.addressInSidebar, systemDark, accent, palette]);
  const layer = (isDark: boolean) => <WindowState g={g} look={lookFor(isDark, accent, palette)} accent={accent} custom={custom ?? null} lay={lay} addr={addr} site={site} icons={switcher ? icons : null} />;
  return (
    <View style={{ width, height }}>
      <WindowFrame g={g} look={look} edge={dark ? mockInk.windowEdge.dark : mockInk.windowEdge.light} style={{ position: "absolute", left: INSET.x, top: INSET.top, width: inner.w, height: inner.h }}>
        <Animated.View style={[fill, { opacity: focusShown.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}>
          {theme.layers.below !== null ? <View style={fill}>{layer(theme.layers.below)}</View> : null}
          <Animated.View style={[fill, { opacity: theme.layers.below !== null ? theme.fade : 1 }]}>{layer(theme.layers.above)}</Animated.View>
          {shape.appearance === "auto" && !switcher ? <AutoBadge key={String(dark)} g={g} look={look} /> : null}
        </Animated.View>
        {demo ? (
          <Animated.View style={[fill, { opacity: focusShown }]}>
            <FocusDemo key={demo} id={demo} g={g} look={look} opts={opts} />
          </Animated.View>
        ) : null}
      </WindowFrame>
    </View>
  );
}

const FocusDemo = memo(function FocusDemo({ id, g, look, opts }: { id: PreviewId; g: Geo; look: Look; opts: SceneOpts }) {
  const { Scene, duration } = DEMOS[id];
  const p = useDemo(true, duration);
  return <Scene g={g} look={look} p={p} opts={opts} />;
});

function AutoBadge({ g, look }: { g: Geo; look: Look }) {
  const p = useDemo(true, sceneMs.autoBadge);
  const t = tracker(p, sceneMs.autoBadge);
  return (
    <Pill g={g} look={look} style={{ opacity: t.in(0, 220), transform: [{ translateY: t([[0, 6 * g.s], [300, 0]]) }] }}>
      <Animated.View style={{ transform: [{ rotate: t.deg([[60, -120], [700, 0]]) }] }}>
        <Glyph g={g} name={look.dark ? "moon.fill" : "sun.max.fill"} size={14} color={look.dark ? mockInk.moon : mockInk.sun} weight="medium" box={18} />
      </Animated.View>
      <Label g={g} size={font.body.fontSize} color={look.t.textPrimary} weight="500">
        {`Auto · ${look.dark ? "Dark" : "Light"} like your Mac`}
      </Label>
    </Pill>
  );
}

function AccentBackdrop({ g, look, accent, custom }: { g: Geo; look: Look; accent: string; custom: ProfileTheme | null }) {
  const { layers, fade } = useFadeBetween(accent);
  const palette = useBasePaletteValue();
  const customShown = useTo(custom ? 1 : 0, true, mockMotion.fade);
  return (
    <View style={fill} pointerEvents="none">
      {layers.below !== null ? <Backdrop g={g} look={lookFor(look.dark, layers.below, palette)} /> : null}
      <Animated.View style={[fill, { opacity: layers.below !== null ? fade : 1 }]}>
        <Backdrop g={g} look={lookFor(look.dark, layers.above, palette)} />
      </Animated.View>
      {custom ? (
        <Animated.View style={[fill, { opacity: customShown }]}>
          <ThemeBackdrop theme={resolveTheme(custom, look.dark)} dark={look.dark} style={fill} />
        </Animated.View>
      ) : null}
    </View>
  );
}

type WindowStateProps = { g: Geo; look: Look; accent: string; custom: ProfileTheme | null; lay: Animated.Value; addr: Animated.Value; site: Animated.Value; icons: Animated.Value | null };

const WindowState = memo(function WindowState({ g, look, accent, custom, lay, addr, site, icons }: WindowStateProps) {
  const s = g.s;
  const lerp = (v: Animated.Value, a: number, b: number) => v.interpolate({ inputRange: [0, 1], outputRange: [a * s, b * s] });
  const fade = (v: Animated.Value, a: number, b: number) => v.interpolate({ inputRange: [0, 1], outputRange: [a, b] });
  const sideCardW = g.W - SIDE_CARD_X - CARD;
  const step = CHIP.w + CHIP.gap;
  const chips = Math.max(1, Math.min(4, Math.floor((g.W - CHIP.x - 40) / step)));
  const rows = Math.max(1, Math.min(6, Math.floor((g.H - ROW.topWithField - ROW.pitch - 20) / ROW.pitch)));
  const crumbLeft = Animated.add(lerp(lay, SIDE_CARD_X + CRUMB_X, CARD + 118), lerp(addr, 0, FIELD.x + 12 - (SIDE_CARD_X + CRUMB_X)));
  const crumbTop = Animated.add(lerp(lay, CARD + 12, STRIP_H + 12), lerp(addr, 0, FIELD.y + 8 - (CARD + 12)));
  const bandSite = (
    <Animated.View style={[fill, { opacity: site }]}>
      <View style={[fill, { backgroundColor: look.site.background ?? look.card }]} />
    </Animated.View>
  );
  return (
    <View style={fill}>
      <AccentBackdrop g={g} look={look} accent={accent} custom={custom} />
      <Animated.View style={{ position: "absolute", left: 0, top: 0, width: 80 * s, height: 50 * s, transform: [{ translateX: lerp(lay, 0, 20.75 - 25) }, { translateY: Animated.add(lerp(lay, 0, LIGHTS_Y.strip - LIGHTS_Y.toolbar), lerp(addr, 0, LIGHTS_Y.field - LIGHTS_Y.toolbar)) }] }}>
        <Lights g={g} />
      </Animated.View>
      <Animated.View style={[fill, { opacity: fade(lay, 1, 0), transform: [{ translateX: lerp(lay, 0, -60) }] }]}>
        <NavIcons g={g} color={look.t.icon} xs={SIDEBAR_ICONS} y={LIGHTS_Y.field} names={["sidebar.left", "chevron.left", "chevron.right"]} style={{ opacity: fade(addr, 0, 1) }} />
        <Animated.View style={[fill, { transform: [{ translateY: lerp(addr, 0, ROW.topWithField - ROW.top) }] }]}>
          <Rows g={g} look={look} n={rows} sel={0} />
        </Animated.View>
        {icons ? (
          <>
            <MockSwitcher g={g} look={look} icons={false} style={{ opacity: fade(icons, 1, 0) }} />
            <MockSwitcher g={g} look={look} icons style={{ opacity: icons }} />
          </>
        ) : null}
        <FieldPlate
          g={g}
          look={look}
          style={{
            left: Animated.add(crumbLeft, -12 * s),
            top: Animated.add(crumbTop, -8 * s),
            width: lerp(addr, 320, FIELD.w),
            height: FIELD.h * s,
            opacity: fade(addr, 0, 1),
          }}
        />
      </Animated.View>
      <Animated.View style={[fill, { opacity: lay, transform: [{ translateY: lerp(lay, -8, 0) }] }]}>
        <TopTabPlate g={g} look={look} x={CHIP.x}>
          {bandSite}
        </TopTabPlate>
        {Array.from({ length: chips }, (_, i) => (
          <TabRow key={i} g={g} look={look} t={tab(i)} x={CHIP.x + i * step} y={CHIP.top - 1} w={CHIP.w} />
        ))}
      </Animated.View>
      <Card
        g={g}
        look={look}
        style={{
          left: lerp(lay, SIDE_CARD_X, CARD),
          top: lerp(lay, CARD, STRIP_H),
          width: lerp(lay, sideCardW, g.W - 2 * CARD),
          height: lerp(lay, g.H - 2 * CARD, g.H - STRIP_H - CARD),
        }}
      >
        <Animated.View style={[fill, { transform: [{ translateY: lerp(addr, 0, -TOOLBAR_H) }] }]}>
          <Page g={g} look={look} top={TOOLBAR_H} />
        </Animated.View>
        <ToolbarBand g={g} fill={look.card} divider={look.plain.divider} dividerStyle={{ opacity: fade(site, 1, 0) }} style={{ opacity: fade(addr, 1, 0) }}>
          {bandSite}
          <Animated.View style={[fill, { opacity: fade(lay, 1, 0) }]}>
            <NavIcons g={g} color={look.plain.icon} xs={TOOLBAR_ICONS} y={21.2} />
          </Animated.View>
          <Animated.View style={[fill, { opacity: lay }]}>
            <NavIcons g={g} color={look.plain.icon} xs={[21, 56, 92]} y={21.2} names={["chevron.left", "chevron.right", "arrow.clockwise"]} />
          </Animated.View>
        </ToolbarBand>
      </Card>
      <Animated.View style={{ position: "absolute", left: crumbLeft, top: crumbTop, width: lerp(addr, 300, FIELD.w - 24), height: 18 * s }}>
        <Crumb g={g} look={look} t={tab(0)} />
      </Animated.View>
    </View>
  );
});
