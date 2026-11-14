import { useRef, useState } from "react";
import { StyleSheet, View, type GestureResponderEvent } from "react-native";
import { colorHex, PAD_LIGHTNESS, padColor } from "../../lib/profileLook";
import { DEFAULT_COLORS, type BoostColors } from "../../state/boosts/types";
import { Box, Button, ink, ThemeSwatch, useTheme } from "../ui";
import { Slider } from "../settings/ThemeControls";
import { BOOST_PANEL } from "./tokens";

const WHEEL = BOOST_PANEL.wheel;
const RADIUS = WHEEL / 2;
const RING = StyleSheet.hairlineWidth * 2;

const rad = (degrees: number) => (degrees * Math.PI) / 180;
const wrap360 = (degrees: number) => ((degrees % 360) + 360) % 360;
const wrap180 = (degrees: number) => ((((degrees + 180) % 360) + 360) % 360) - 180;
const at = (degrees: number, radius: number) => ({ x: RADIUS + radius * Math.cos(rad(degrees)), y: RADIUS + radius * Math.sin(rad(degrees)) });
const dotColor = (degrees: number, saturation: number) => {
  const point = at(degrees, saturation * RADIUS);
  return colorHex(padColor(point.x / WHEEL, point.y / WHEEL, PAD_LIGHTNESS));
};

type Change = (colors: BoostColors | null, settle: boolean) => void;

function Dot({ degrees, saturation, size }: { degrees: number; saturation: number; size: number }) {
  const point = at(degrees, saturation * RADIUS);
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: point.x - size / 2,
        top: point.y - size / 2,
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 3,
        borderColor: ink.white,
        backgroundColor: dotColor(degrees, saturation),
      }}
    />
  );
}

function Wheel({ colors, onChange }: { colors: BoostColors | null; onChange: Change }) {
  const ref = useRef<View>(null);
  const origin = useRef({ x: 0, y: 0 });
  const dragging = useRef<"primary" | "secondary">("primary");
  const latest = useRef(colors);
  latest.current = colors;
  const measure = () => ref.current?.measureInWindow((x, y) => (origin.current = { x, y }));
  const point = (e: GestureResponderEvent) => ({ x: e.nativeEvent.pageX - origin.current.x - RADIUS, y: e.nativeEvent.pageY - origin.current.y - RADIUS });
  const move = (e: GestureResponderEvent, settle: boolean) => {
    const { x, y } = point(e);
    const degrees = wrap360((Math.atan2(y, x) * 180) / Math.PI);
    const base = latest.current ?? DEFAULT_COLORS;
    if (dragging.current === "secondary" && latest.current) return onChange({ ...base, offset: Math.round(wrap180(degrees - base.hue)) }, settle);
    onChange({ ...base, hue: Math.round(degrees), saturation: Math.min(1, Math.hypot(x, y) / RADIUS) }, settle);
  };
  return (
    <View
      ref={ref}
      onLayout={measure}
      onMouseEnter={measure}
      accessibilityRole="adjustable"
      accessibilityLabel="Colour wheel"
      style={{ width: WHEEL, height: WHEEL, alignSelf: "center" }}
      onStartShouldSetResponder={() => true}
      onResponderGrant={(e) => {
        measure();
        const { x, y } = point(e);
        const c = latest.current;
        const edge = c ? at(c.hue + c.offset, RADIUS) : null;
        dragging.current = edge && Math.hypot(edge.x - RADIUS - x, edge.y - RADIUS - y) <= BOOST_PANEL.edgeDot / 2 + 4 ? "secondary" : "primary";
        if (dragging.current === "primary") move(e, false);
      }}
      onResponderMove={(e) => move(e, false)}
      onResponderRelease={(e) => move(e, true)}
      onResponderTerminate={() => onChange(latest.current, true)}
    >
      <View style={{ width: WHEEL, height: WHEEL, borderRadius: RADIUS, overflow: "hidden" }}>
        <ThemeSwatch colors={[]} padLightness={PAD_LIGHTNESS} style={StyleSheet.absoluteFill} />
      </View>
      {colors ? (
        <>
          <Dot degrees={colors.hue + colors.offset} saturation={1} size={BOOST_PANEL.edgeDot} />
          <Dot degrees={colors.hue} saturation={colors.saturation} size={BOOST_PANEL.dot} />
        </>
      ) : null}
    </View>
  );
}

export function BoostColorsSection({ colors, onChange }: { colors: BoostColors | null; onChange: Change }) {
  const theme = useTheme();
  const [advanced, setAdvanced] = useState(false);
  const shown = colors ?? DEFAULT_COLORS;
  const set = (patch: Partial<BoostColors>, settle: boolean) => onChange({ ...shown, ...patch }, settle);
  return (
    <Box gap="l">
      <Wheel colors={colors} onChange={onChange} />
      <Box row center gap="s">
        <Button
          variant="icon"
          icon={shown.invert ? "lightbulb.slash.fill" : "lightbulb.fill"}
          tooltip={shown.invert ? "Restore lightness" : "Invert lightness"}
          active={!!colors?.invert}
          color={colors?.invert ? theme.accent : undefined}
          onPress={() => set({ invert: !shown.invert }, true)}
        />
        <View style={{ flex: 1 }} />
        <Button variant="text" title="Reset" disabled={!colors} onPress={() => onChange(null, true)} />
        <Button variant="text" title={advanced ? "Hide Advanced" : "Advanced"} onPress={() => setAdvanced(!advanced)} />
      </Box>
      {advanced ? (
        <Box gap="m">
          <Slider stacked label="Original Saturation" value={shown.originalSaturation} onChange={(v, settle) => set({ originalSaturation: v }, settle)} />
          <Slider stacked label="Contrast" value={shown.contrast} onChange={(v, settle) => set({ contrast: v }, settle)} />
          <Slider stacked label="Brightness" value={(shown.brightness + 1) / 2} onChange={(v, settle) => set({ brightness: v * 2 - 1 }, settle)} />
        </Box>
      ) : null}
    </Box>
  );
}
