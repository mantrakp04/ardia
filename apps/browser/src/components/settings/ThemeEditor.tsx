import { holdThemedWindowsKeyLook, ThemeSwatch } from "@ardia/shaders";
import { showMenu, Symbol, type MenuItem } from "@ardia/shell";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from "react-native";
import {
  colorHex,
  flatColors,
  MAX_THEME_STOPS,
  PAD_LIGHTNESS,
  resolveTheme,
  startingTheme,
  THEME_TEXTURES,
  themeAccent,
  themeDark,
  themeGrainAlpha,
  themeLayerAlpha,
  themeUnderColor,
  withAddedStop,
  withoutStop,
  withStopAt,
} from "../../lib/profileTheme";
import { PROFILE_COLORS, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { choosePresetColor, setProfileTheme } from "../../lib/profileThemeActions";
import type { ProfileColor, ProfileTheme, ThemeMode, ThemeTexture } from "../../store/types";
import { parseArcTheme } from "../import/arcTheme";
import { importModule } from "../import/module";
import { useHover } from "../primitives";
import { Button, Group, PopUp, Row, SectionHeader, useFormColors } from "./controls";

const PAD = 172;
const KNOB = 22;
const SWATCH = 20;
const LABEL = 112;

const MODES: { value: ThemeMode; symbol: string; title: string }[] = [
  { value: "light", symbol: "sun.max", title: "Light" },
  { value: "dark", symbol: "moon", title: "Dark" },
  { value: "auto", symbol: "circle.lefthalf.filled", title: "Match System" },
];

const TEXTURE_NAMES: Record<ThemeTexture, string> = { grain: "Grain", sand: "Sand", denim: "Denim", tweed: "Tweed" };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function useLiveTheme(profileId: string, theme: ProfileTheme | null | undefined) {
  const [draft, setDraft] = useState<ProfileTheme | null>(null);
  const pending = useRef<ProfileTheme | null>(null);
  const frame = useRef<number | null>(null);
  useEffect(() => () => void (frame.current !== null && cancelAnimationFrame(frame.current)), []);
  const flush = () => {
    frame.current = null;
    if (pending.current) setProfileTheme(profileId, pending.current);
  };
  const change = (next: ProfileTheme, settle = false) => {
    pending.current = next;
    setDraft(settle ? null : next);
    if (settle) {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      flush();
    } else if (frame.current === null) frame.current = requestAnimationFrame(flush);
  };
  return { theme: draft ?? theme ?? null, change };
}

export function ThemeSection({ profileId }: { profileId: string }) {
  const profile = useBrowser((s) => s.profiles[profileId]);
  const live = useLiveTheme(profileId, profile?.theme);
  const appDark = useBrowser((s) => s.ui.appDark);
  const editing = !!profile && !!live.theme;
  useEffect(() => {
    if (!editing) return;
    holdThemedWindowsKeyLook(true);
    return () => holdThemedWindowsKeyLook(false);
  }, [editing]);
  if (!profile) return null;
  const stored = live.theme;
  const custom = stored?.dark ? resolveTheme(stored, themeDark(stored, appDark)) : stored;
  const choosePreset = (color: ProfileColor) => choosePresetColor(profileId, color);
  const chooseCustom = () => {
    if (!custom) live.change(startingTheme(PROFILE_COLORS[profile.color]?.swatch ?? PROFILE_COLORS.plum.swatch), true);
  };
  return (
    <>
      <SectionHeader
        title="Theme"
        description="Tints this profile's windows, New Tab page and highlights."
        action={<Button title="Import from Arc…" onPress={() => void importArcTheme(profileId)} />}
      />
      <Group>
        <Row
          title="Colour"
          description={
            stored?.dark
              ? `Separate light and dark looks. Editing keeps the ${themeDark(stored, appDark) ? "dark" : "light"} one.`
              : custom
                ? "Custom gradient"
                : PROFILE_COLORS[profile.color]?.name
          }
        >
          <View style={{ flexDirection: "row", gap: 7 }}>
            {(Object.keys(PROFILE_COLORS) as ProfileColor[]).map((c) => (
              <Pressable key={c} onPress={() => choosePreset(c)} tooltip={PROFILE_COLORS[c].name}>
                <SwatchRing selected={!custom && profile.color === c} ring={PROFILE_COLORS[c].swatch}>
                  <View style={{ flex: 1, borderRadius: 8, backgroundColor: PROFILE_COLORS[c].swatch }} />
                </SwatchRing>
              </Pressable>
            ))}
            <Pressable onPress={chooseCustom} tooltip="Custom">
              <SwatchRing selected={!!custom} ring={custom ? themeAccent(custom) : "#8E8E93"}>
                <CustomSwatch theme={custom} />
              </SwatchRing>
            </Pressable>
          </View>
        </Row>
        {custom ? <ThemeEditor theme={custom} onChange={live.change} /> : null}
      </Group>
    </>
  );
}

function SwatchRing({ selected, ring, children }: { selected: boolean; ring: string; children: ReactNode }) {
  return (
    <View style={{ width: SWATCH, height: SWATCH, borderRadius: SWATCH / 2, padding: 2, borderWidth: 2, borderColor: selected ? ring : "transparent" }}>
      {children}
    </View>
  );
}

const RAINBOW: ProfileTheme = {
  stops: [
    { x: 1, y: 0.5, color: { r: 0.93, g: 0.45, b: 0.62, a: 1 } },
    { x: 0, y: 0.5, color: { r: 0.42, g: 0.66, b: 0.95, a: 1 } },
    { x: 0.5, y: 1, color: { r: 0.62, g: 0.9, b: 0.58, a: 1 } },
  ],
  intensity: 1,
  mode: "auto",
  grain: 0,
  texture: "grain",
  translucency: 0,
};

function CustomSwatch({ theme }: { theme: ProfileTheme | null }) {
  return (
    <View style={{ flex: 1, borderRadius: 8, overflow: "hidden" }}>
      <ThemeSwatch colors={flatColors(theme ?? RAINBOW)} style={{ flex: 1 }} />
    </View>
  );
}

function ThemeEditor({ theme, onChange }: { theme: ProfileTheme; onChange: (next: ProfileTheme, settle?: boolean) => void }) {
  const ui = useTheme();
  const colors = useFormColors();
  const [selected, setSelected] = useState(0);
  const index = Math.min(selected, theme.stops.length - 1);
  return (
    <View style={{ padding: 12, flexDirection: "row", gap: 18 }}>
      <View style={{ gap: 8 }}>
        <ColorPad theme={theme} selected={index} onSelect={setSelected} onChange={onChange} />
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ fontSize: 11.5, color: ui.textSecondary }}>
            {theme.stops.length} of {MAX_THEME_STOPS} colours
          </Text>
          <View style={{ flexDirection: "row", gap: 4 }}>
            <SmallButton
              symbol="minus"
              tooltip="Remove Colour"
              disabled={theme.stops.length <= 1}
              onPress={() => {
                onChange(withoutStop(theme, index), true);
                setSelected(Math.max(0, index - 1));
              }}
            />
            <SmallButton
              symbol="plus"
              tooltip="Add Colour"
              disabled={theme.stops.length >= MAX_THEME_STOPS}
              onPress={() => {
                onChange(withAddedStop(theme), true);
                setSelected(theme.stops.length);
              }}
            />
          </View>
        </View>
      </View>
      <View style={{ flex: 1, gap: 11 }}>
        <Preview theme={theme} />
        <Slider label="Intensity" value={theme.intensity} onChange={(v, settle) => onChange({ ...theme, intensity: v }, settle)} />
        <Slider
          label="Pass-through blur"
          value={theme.translucency}
          onChange={(v, settle) => onChange({ ...theme, translucency: v }, settle)}
        />
        <Slider label="Noise" value={theme.grain} onChange={(v, settle) => onChange({ ...theme, grain: v }, settle)}>
          <PopUp
            value={theme.texture}
            minWidth={78}
            options={THEME_TEXTURES.map((t) => ({ value: t, title: TEXTURE_NAMES[t] }))}
            onChange={(texture) => onChange({ ...theme, texture, grain: theme.grain || 0.5 }, true)}
          />
        </Slider>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={{ width: LABEL + 10, fontSize: 12, color: ui.textPrimary }}>Appearance</Text>
          <View style={{ flexDirection: "row", borderRadius: 6, backgroundColor: colors.control, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.controlBorder, padding: 1 }}>
            {MODES.map((m) => (
              <Pressable key={m.value} tooltip={m.title} onPress={() => onChange({ ...theme, mode: m.value }, true)}>
                <View
                  style={{
                    width: 30,
                    height: 20,
                    borderRadius: 5,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: theme.mode === m.value ? colors.accent : undefined,
                  }}
                >
                  <Symbol name={m.symbol} size={11} color={theme.mode === m.value ? "#FFFFFF" : ui.icon} style={{ width: 14, height: 14 }} />
                </View>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </View>
  );
}

function Preview({ theme }: { theme: ProfileTheme }) {
  const appDark = useBrowser((s) => s.ui.appDark);
  const dark = themeDark(theme, appDark);
  return (
    <View style={{ height: 58, borderRadius: 9, overflow: "hidden", backgroundColor: themeUnderColor(theme, dark) }}>
      <ThemeSwatch colors={flatColors(theme)} style={[StyleSheet.absoluteFill, { opacity: themeLayerAlpha(theme) }]} />
      <ThemeSwatch colors={[]} grain={themeGrainAlpha(theme)} texture={theme.texture} style={StyleSheet.absoluteFill} />
      <View style={{ position: "absolute", left: 8, top: 10, width: 34, gap: 5 }}>
        {[1, 0.7, 0.85].map((w, i) => (
          <View key={i} style={{ width: `${w * 100}%`, height: 4, borderRadius: 2, backgroundColor: dark ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.18)" }} />
        ))}
      </View>
      <View style={{ position: "absolute", left: 50, top: 6, right: 6, bottom: 6, borderRadius: 6, backgroundColor: dark ? "rgba(18,18,18,0.72)" : "rgba(255,255,255,0.82)" }} />
    </View>
  );
}

function ColorPad({
  theme,
  selected,
  onSelect,
  onChange,
}: {
  theme: ProfileTheme;
  selected: number;
  onSelect: (index: number) => void;
  onChange: (next: ProfileTheme, settle?: boolean) => void;
}) {
  const ref = useRef<View>(null);
  const origin = useRef({ x: 0, y: 0 });
  const dragging = useRef(0);
  const latest = useRef(theme);
  latest.current = theme;
  const measure = () => ref.current?.measureInWindow((x, y) => (origin.current = { x, y }));
  const point = (e: GestureResponderEvent) => ({
    x: clamp01((e.nativeEvent.pageX - origin.current.x) / PAD),
    y: clamp01((e.nativeEvent.pageY - origin.current.y) / PAD),
  });
  const insideCircle = (p: { x: number; y: number }) => {
    const dx = p.x - 0.5, dy = p.y - 0.5, r = Math.hypot(dx, dy);
    return r <= 0.5 ? p : { x: 0.5 + (dx / r) * 0.5, y: 0.5 + (dy / r) * 0.5 };
  };
  const move = (e: GestureResponderEvent, settle = false) => {
    const p = insideCircle(point(e));
    onChange(withStopAt(latest.current, dragging.current, p.x, p.y), settle);
  };
  return (
    <View
      ref={ref}
      onLayout={measure}
      onMouseEnter={measure}
      style={{ width: PAD, height: PAD }}
      onStartShouldSetResponder={() => true}
      onResponderGrant={(e) => {
        measure();
        const p = point(e);
        const stops = latest.current.stops;
        const hit = stops.findIndex((s) => Math.hypot((s.x - p.x) * PAD, (s.y - p.y) * PAD) <= KNOB / 2 + 3);
        dragging.current = hit >= 0 ? hit : selected;
        onSelect(dragging.current);
        if (hit < 0) move(e);
      }}
      onResponderMove={(e) => move(e)}
      onResponderRelease={(e) => move(e, true)}
      onResponderTerminate={() => onChange(latest.current, true)}
    >
      <View style={{ position: "absolute", left: 0, top: 0, width: PAD, height: PAD, borderRadius: PAD / 2, overflow: "hidden" }}>
        <ThemeSwatch colors={[]} padLightness={PAD_LIGHTNESS} style={StyleSheet.absoluteFill} />
      </View>
      {theme.stops.map((s, i) => (
        <View
          key={i}
          pointerEvents="none"
          style={{
            position: "absolute",
            left: s.x * PAD - KNOB / 2,
            top: s.y * PAD - KNOB / 2,
            width: KNOB,
            height: KNOB,
            borderRadius: KNOB / 2,
            borderWidth: i === selected ? 3 : 2,
            borderColor: "#FFFFFF",
            backgroundColor: colorHex(s.color),
          }}
        >
          <View style={{ position: "absolute", left: -3, top: -3, right: -3, bottom: -3, borderRadius: KNOB / 2 + 3, borderWidth: 1, borderColor: "rgba(0,0,0,0.25)" }} />
        </View>
      ))}
    </View>
  );
}

function SmallButton({ symbol, tooltip, disabled, onPress }: { symbol: string; tooltip: string; disabled?: boolean; onPress: () => void }) {
  const ui = useTheme();
  const colors = useFormColors();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps} style={{ opacity: disabled ? 0.4 : 1 }}>
      <Pressable disabled={disabled} onPress={onPress} tooltip={tooltip}>
        {({ pressed }) => (
          <View
            style={{
              width: 24,
              height: 20,
              borderRadius: 5,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: pressed ? colors.controlPressed : hovered ? colors.controlHover : colors.control,
              borderWidth: StyleSheet.hairlineWidth * 2,
              borderColor: colors.controlBorder,
            }}
          >
            <Symbol name={symbol} size={10} weight="semibold" color={ui.icon} style={{ width: 12, height: 12 }} />
          </View>
        )}
      </Pressable>
    </View>
  );
}

function Slider({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: number;
  onChange: (value: number, settle: boolean) => void;
  children?: ReactNode;
}) {
  const ui = useTheme();
  const colors = useFormColors();
  const ref = useRef<View>(null);
  const frame = useRef({ x: 0, width: 1 });
  const measure = () => ref.current?.measureInWindow((x, _y, width) => (frame.current = { x, width: Math.max(1, width) }));
  const at = (e: GestureResponderEvent) => clamp01((e.nativeEvent.pageX - frame.current.x) / frame.current.width);
  const thumb = 14;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Text numberOfLines={1} style={{ width: LABEL, fontSize: 12, color: ui.textPrimary }}>{label}</Text>
      <View
        ref={ref}
        onLayout={measure}
        onMouseEnter={measure}
        style={{ flex: 1, height: 20, justifyContent: "center" }}
        onStartShouldSetResponder={() => true}
        onResponderGrant={(e) => {
          measure();
          onChange(at(e), false);
        }}
        onResponderMove={(e) => onChange(at(e), false)}
        onResponderRelease={(e) => onChange(at(e), true)}
        onResponderTerminate={() => onChange(value, true)}
      >
        <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.switchOff, overflow: "hidden" }}>
          <View style={{ width: `${value * 100}%`, height: 4, backgroundColor: colors.accent }} />
        </View>
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: `${value * 100}%`,
            marginLeft: -thumb / 2,
            width: thumb,
            height: thumb,
            borderRadius: thumb / 2,
            backgroundColor: "#FFFFFF",
            borderWidth: StyleSheet.hairlineWidth * 2,
            borderColor: "rgba(0,0,0,0.2)",
          }}
        />
      </View>
      {children}
    </View>
  );
}

export async function arcThemeChoices(): Promise<{ id: string; name: string; emoji?: string; color?: string; theme: ProfileTheme }[]> {
  const api = importModule();
  if (!api) return [];
  const browsers = await api.listBrowsers().catch(() => []);
  const arc = browsers.find((b) => b.id === "arc");
  return (arc?.profiles ?? []).flatMap((p) =>
    (p.spaces ?? []).flatMap((s) => {
      const theme = s.theme ? parseArcTheme(s.theme) : null;
      return theme ? [{ id: s.id, name: s.name, emoji: s.emoji, color: s.color, theme }] : [];
    }),
  );
}

export async function importArcTheme(profileId: string): Promise<boolean> {
  const choices = await arcThemeChoices();
  const items: MenuItem[] = choices.length
    ? choices.map((c) => ({ id: c.id, title: c.emoji ? `${c.emoji}  ${c.name}` : c.name, swatch: themeAccent(c.theme) }))
    : [{ id: "none", title: "No Arc spaces with a theme found", enabled: false }];
  const choice = await showMenu(items);
  const picked = choices.find((c) => c.id === choice);
  if (!picked) return false;
  setProfileTheme(profileId, picked.theme);
  return true;
}


