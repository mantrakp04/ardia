import { memo } from "react";
import { Animated, Pressable, View } from "react-native";
import { Symbol, useHover } from "../ui";
import { useTheme } from "../ui/theme";
import { WINDOW_CHROME, WINDOW_CONTROLS, windowControlsWidth } from "../../lib/windowChrome";
import { useWindowMaximized } from "../../state/windows/captionRegions";
import { WINDOW_BUTTONS } from "./tokens";
import { closeFromWindowControls, minimizeWindow, toggleWindowMaximized } from "../../state/windows/controls";

const B = WINDOW_BUTTONS;

type Ink = { icon: string; hover: string; pressed: string };
type Kind = "minimize" | "maximize" | "restore" | "close";

const LABEL: Record<Kind, string> = { minimize: "Minimize", maximize: "Maximize", restore: "Restore Down", close: "Close" };

function Glyph({ kind, color, box }: { kind: Kind; color: string; box: number }) {
  if (kind === "minimize") return <View style={{ width: box, height: 1, backgroundColor: color }} />;
  if (kind === "maximize") return <View style={{ width: box, height: box, borderWidth: 1, borderRadius: B.glyphRadius, borderColor: color }} />;
  if (kind === "restore") {
    const pane = box - 2;
    return (
      <View style={{ width: box, height: box }}>
        <View style={{ position: "absolute", right: 0, top: 0, width: pane, height: pane, borderTopWidth: 1, borderRightWidth: 1, borderTopRightRadius: B.restoreCorner, borderColor: color }} />
        <View style={{ position: "absolute", left: 0, bottom: 0, width: pane, height: pane, borderWidth: 1, borderRadius: B.glyphRadius, borderColor: color }} />
      </View>
    );
  }
  return <Symbol name="xmark" size={box} weight="regular" color={color} style={{ width: box + 4, height: box + 4 }} />;
}

function ControlButton({ kind, width, height, radius, ink, onPress }: { kind: Kind; width: number; height: number; radius: number; ink: Ink; onPress: () => void }) {
  const { hovered, hoverProps } = useHover();
  const close = kind === "close";
  return (
    <View {...hoverProps}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={LABEL[kind]}>
        {({ pressed }) => (
          <View
            style={{
              width,
              height,
              borderRadius: radius,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: pressed ? (close ? B.closePressed : ink.pressed) : hovered ? (close ? B.closeHover : ink.hover) : undefined,
            }}
          >
            <Glyph kind={kind} color={close && (hovered || pressed) ? B.closeInk : ink.icon} box={height < B.smallBelow ? B.smallGlyph : B.glyph} />
          </View>
        )}
      </Pressable>
    </View>
  );
}

export type WindowControlsProps = {
  windowId: string;
  centerY: number;
  size: number;
  maximizable?: boolean;
  minimizable?: boolean;
  ink?: Partial<Ink>;
  opacity?: Animated.AnimatedInterpolation<number> | number;
  hidden?: boolean;
};

export const controlsShown = WINDOW_CHROME.trailingWidth > 0;

export const WindowControls = memo(function WindowControls({ windowId, centerY, size, maximizable = true, minimizable = true, ink, opacity = 1, hidden = false }: WindowControlsProps) {
  const theme = useTheme();
  const maximized = useWindowMaximized(windowId);
  if (!controlsShown) return null;
  const colors: Ink = { icon: ink?.icon ?? theme.icon, hover: ink?.hover ?? theme.toolbarHover, pressed: ink?.pressed ?? theme.toolbarPressed };
  const width = WINDOW_CONTROLS.button;
  const plateRadius = Math.min(B.plateRadius.most, Math.round(size / B.plateRadius.share));
  const count = 1 + (maximizable ? 1 : 0) + (minimizable ? 1 : 0);
  return (
    <Animated.View
      pointerEvents={hidden ? "none" : "box-none"}
      style={{
        position: "absolute",
        right: WINDOW_CONTROLS.edge,
        top: centerY - size / 2,
        width: windowControlsWidth(count),
        height: size,
        flexDirection: "row",
        gap: WINDOW_CONTROLS.gap,
        opacity,
      }}
    >
      {minimizable ? <ControlButton kind="minimize" width={width} height={size} radius={plateRadius} ink={colors} onPress={() => minimizeWindow(windowId)} /> : null}
      {maximizable ? <ControlButton kind={maximized ? "restore" : "maximize"} width={width} height={size} radius={plateRadius} ink={colors} onPress={() => toggleWindowMaximized(windowId)} /> : null}
      <ControlButton kind="close" width={width} height={size} radius={plateRadius} ink={colors} onPress={() => closeFromWindowControls(windowId)} />
    </Animated.View>
  );
});
