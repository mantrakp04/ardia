import { useRef, type ReactNode } from "react";
import { StyleSheet, Text, View, type GestureResponderEvent } from "react-native";
import { colorHex, flatColors, lookAngle, PAD_LIGHTNESS, padColor, stopLightness, themeGrainAlpha, themeLayerAlpha, themeUnderColor, withStopAt, withStopLightness, type ShownLook } from "../../lib/profileLook";
import type { ProfileTheme } from "../../state/browser/types";
import { font, ink, ThemeSwatch, useTheme } from "../ui";
import { settingsInk, themePreview } from "./tokens";

export const PAD = 172;
const KNOB = 22;
export const LABEL = 112;
const LIGHTNESS_STEPS = 24;
const THUMB = 14;
const DIAL = 28;
const DIAL_SNAP = 4;
const DIAL_BORDER = StyleSheet.hairlineWidth * 2;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function DirectionDial({ angle, onChange }: { angle: number; onChange: (angle: number, settle: boolean) => void }) {
  const ui = useTheme();
  const ref = useRef<View>(null);
  const centre = useRef({ x: 0, y: 0 });
  const measure = () => ref.current?.measureInWindow((x, y, width, height) => (centre.current = { x: x + width / 2, y: y + height / 2 }));
  const at = (e: GestureResponderEvent) => {
    const dx = e.nativeEvent.pageX - centre.current.x, dy = e.nativeEvent.pageY - centre.current.y;
    const degrees = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
    const notch = Math.round(degrees / 45) * 45;
    return (Math.abs(degrees - notch) <= DIAL_SNAP ? notch : Math.round(degrees)) % 360;
  };
  const step = (by: number) => onChange((Math.round(angle / 45) + by) * 45, true);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <View
        ref={ref}
        onLayout={measure}
        onMouseEnter={measure}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Direction"
        accessibilityValue={{ text: `${Math.round(angle)}°` }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(e) => step(e.nativeEvent.actionName === "increment" ? 1 : -1)}
        tooltip="Drag to turn the gradient"
        style={{ width: DIAL, height: DIAL, borderRadius: DIAL / 2, backgroundColor: ui.control, borderWidth: DIAL_BORDER, borderColor: ui.controlBorder }}
        onStartShouldSetResponder={() => true}
        onResponderGrant={(e) => {
          measure();
          onChange(at(e), false);
        }}
        onResponderMove={(e) => onChange(at(e), false)}
        onResponderRelease={(e) => onChange(at(e), true)}
        onResponderTerminate={() => onChange(angle, true)}
      >
        <View pointerEvents="none" style={{ position: "absolute", left: -DIAL_BORDER, top: -DIAL_BORDER, width: DIAL, height: DIAL, transform: [{ rotate: `${angle}deg` }] }}>
          <View style={{ position: "absolute", left: DIAL / 2 - 1, top: 4, width: 2, height: DIAL / 2 - 4, borderRadius: 1, backgroundColor: ui.formAccent }} />
        </View>
        <View
          pointerEvents="none"
          style={{ position: "absolute", left: DIAL / 2 - DIAL_BORDER - 2.5, top: DIAL / 2 - DIAL_BORDER - 2.5, width: 5, height: 5, borderRadius: 2.5, backgroundColor: ui.formAccent }}
        />
      </View>
      <Text style={{ ...font.footnote, color: ui.textSecondary, fontVariant: ["tabular-nums"] }}>{Math.round(angle)}°</Text>
    </View>
  );
}
export function Preview({ shown }: { shown: ShownLook }) {
  const { look: theme, dark } = shown;
  return (
    <View style={{ height: 58, borderRadius: 9, overflow: "hidden", backgroundColor: themeUnderColor(theme, dark) }}>
      <ThemeSwatch colors={flatColors(theme)} angle={lookAngle(theme)} style={[StyleSheet.absoluteFill, { opacity: themeLayerAlpha(theme) }]} />
      <ThemeSwatch colors={[]} grain={themeGrainAlpha(theme)} texture={theme.texture} style={StyleSheet.absoluteFill} />
      <View style={{ position: "absolute", left: 8, top: 10, width: 34, gap: 5 }}>
        {[1, 0.7, 0.85].map((w, i) => (
          <View key={i} style={{ width: `${w * 100}%`, height: 4, borderRadius: 2, backgroundColor: themePreview[dark ? "dark" : "light"].line }} />
        ))}
      </View>
      <View style={{ position: "absolute", left: 50, top: 6, right: 6, bottom: 6, borderRadius: 6, backgroundColor: themePreview[dark ? "dark" : "light"].card }} />
    </View>
  );
}
export function ColorPad({
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
            borderColor: ink.white,
            backgroundColor: colorHex(s.color),
          }}
        >
          <View style={{ position: "absolute", left: -3, top: -3, right: -3, bottom: -3, borderRadius: KNOB / 2 + 3, borderWidth: 1, borderColor: settingsInk.knobOutline }} />
        </View>
      ))}
    </View>
  );
}
export function LightnessBar({ theme, index, onChange }: { theme: ProfileTheme; index: number; onChange: (next: ProfileTheme, settle?: boolean) => void }) {
  const stop = theme.stops[index]!;
  return (
    <View style={{ width: PAD }}>
      <Track
        value={stopLightness(stop)}
        thumbColor={colorHex(stop.color)}
        tooltip="Brightness"
        onChange={(v, settle) => onChange(withStopLightness(theme, index, v), settle)}
        bar={
          <View style={{ height: 8, borderRadius: 4, overflow: "hidden", flexDirection: "row" }}>
            {Array.from({ length: LIGHTNESS_STEPS }, (_, i) => (
              <View key={i} style={{ flex: 1, backgroundColor: colorHex(padColor(stop.x, stop.y, i / (LIGHTNESS_STEPS - 1))) }} />
            ))}
          </View>
        }
      />
    </View>
  );
}
export function Labelled({ label, children }: { label: string; children: ReactNode }) {
  const ui = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text numberOfLines={1} style={{ ...font.small, color: ui.textPrimary }}>{label}</Text>
      {children}
    </View>
  );
}
export function Slider({
  label,
  value,
  onChange,
  stacked,
  children,
}: {
  label: string;
  value: number;
  onChange: (value: number, settle: boolean) => void;
  stacked?: boolean;
  children?: ReactNode;
}) {
  const ui = useTheme();
  const track = (
    <Track
      value={value}
      onChange={onChange}
      bar={
        <View style={{ height: 4, borderRadius: 2, backgroundColor: ui.switchOff, overflow: "hidden" }}>
          <View style={{ width: `${value * 100}%`, height: 4, backgroundColor: ui.formAccent }} />
        </View>
      }
    />
  );
  if (stacked)
    return (
      <Labelled label={label}>
        {children ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ flex: 1 }}>{track}</View>
            {children}
          </View>
        ) : (
          track
        )}
      </Labelled>
    );
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Text numberOfLines={1} style={{ width: LABEL, ...font.small, color: ui.textPrimary }}>{label}</Text>
      <View style={{ flex: 1 }}>{track}</View>
      {children}
    </View>
  );
}
export function AmountSlider({ value, onChange, tooltip }: { value: number; onChange: (value: number, settle: boolean) => void; tooltip?: string }) {
  const ui = useTheme();
  return (
    <Track
      value={value}
      onChange={onChange}
      tooltip={tooltip}
      bar={
        <View style={{ height: 4, borderRadius: 2, backgroundColor: ui.switchOff, overflow: "hidden" }}>
          <View style={{ width: `${value * 100}%`, height: 4, backgroundColor: ui.formAccent }} />
        </View>
      }
    />
  );
}

function Track({
  value,
  onChange,
  bar,
  thumbColor,
  tooltip,
}: {
  value: number;
  onChange: (value: number, settle: boolean) => void;
  bar: ReactNode;
  thumbColor?: string;
  tooltip?: string;
}) {
  const ref = useRef<View>(null);
  const frame = useRef({ x: 0, width: 1 });
  const measure = () => ref.current?.measureInWindow((x, _y, width) => (frame.current = { x, width: Math.max(1, width) }));
  const at = (e: GestureResponderEvent) => clamp01((e.nativeEvent.pageX - frame.current.x) / frame.current.width);
  return (
    <View
      onLayout={measure}
      onMouseEnter={measure}
      tooltip={tooltip}
      style={{ paddingHorizontal: THUMB / 2 }}
      onStartShouldSetResponder={() => true}
      onResponderGrant={(e) => {
        measure();
        onChange(at(e), false);
      }}
      onResponderMove={(e) => onChange(at(e), false)}
      onResponderRelease={(e) => onChange(at(e), true)}
      onResponderTerminate={() => onChange(value, true)}
    >
      <View ref={ref} style={{ height: 20, justifyContent: "center" }}>
        {bar}
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: `${value * 100}%`,
            marginLeft: -THUMB / 2,
            width: THUMB,
            height: THUMB,
            borderRadius: THUMB / 2,
            backgroundColor: thumbColor ?? ink.white,
            borderWidth: thumbColor ? 2 : StyleSheet.hairlineWidth * 2,
            borderColor: thumbColor ? ink.white : settingsInk.thumbBorder,
          }}
        >
          {thumbColor ? (
            <View style={{ position: "absolute", left: -3, top: -3, right: -3, bottom: -3, borderRadius: THUMB / 2 + 3, borderWidth: 1, borderColor: settingsInk.knobOutline }} />
          ) : null}
        </View>
      </View>
    </View>
  );
}
