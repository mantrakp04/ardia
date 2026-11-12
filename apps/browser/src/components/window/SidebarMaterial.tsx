import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useSettings } from "../../state/browser/hooks";
import { parseColor, toHex } from "../../lib/color";
import { GlassBackdrop, liquidGlass, Panel, WindowBackdrop } from "../ui";
import { useTheme } from "../ui/theme";
import { ink } from "../ui/tokens";
import { SHADOWS } from "./tokens";

export function SidebarMaterial({ peeking, radius, left, top, bottom, right, windowWidth, bleed }: {
  peeking: boolean;
  radius: number;
  left: number;
  top: number;
  bottom: number;
  right: boolean;
  windowWidth: number;
  bleed: number;
}) {
  const theme = useTheme();
  const enabled = useSettings((s) => s.glassSidebar);
  const [height, setHeight] = useState(0);
  const glass = peeking && enabled && liquidGlass;
  const [r, g, b] = parseColor(theme.backdrop.tintColor);
  const tint = toHex([r, g, b, theme.backdrop.tintAlpha * 255]);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={(e) => setHeight(e.nativeEvent.layout.height)}>
      <Panel fill={glass ? ink.clear : theme.windowTint[0]} border={glass ? null : undefined} radius={radius} shadow={SHADOWS.sidebarPeek} style={StyleSheet.absoluteFill} />
      {glass ? <GlassBackdrop radius={radius} tint={tint} dark={theme.dark} style={StyleSheet.absoluteFill} /> : peeking ? (
        <View style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: "hidden" }]}>
          <WindowBackdrop
            vibrancy
            {...theme.backdrop}
            colors={theme.windowTint}
            grainOpacity={theme.grain}
            style={{ position: "absolute", [right ? "right" : "left"]: -left, top: -top, width: windowWidth + bleed, height: height + top + bottom }}
          />
        </View>
      ) : null}
    </View>
  );
}
