import { Symbol } from "@ardia/shell";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, Text, View } from "react-native";
import { cliCommand, cliProduct, stopCliControl, useCli } from "../lib/cliControl";
import { useTheme } from "../lib/theme";
import { PromptButton } from "./layout/controls";
import { useHover } from "./primitives";

const BAR_HEIGHT = 38;

const useControlled = () => useCli((s) => s.server?.state === "on" && (s.server.connections ?? 0) > 0);

export function CliControlBar() {
  const visible = useControlled();
  const [mounted, setMounted] = useState(visible);
  useEffect(() => {
    if (visible) setMounted(true);
  }, [visible]);
  if (!mounted && !visible) return null;
  return <ShownCliControlBar visible={visible} onHidden={() => setMounted(false)} />;
}

function ShownCliControlBar({ visible, onHidden }: { visible: boolean; onHidden: () => void }) {
  const theme = useTheme();
  const height = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(height, { toValue: visible ? BAR_HEIGHT : 0, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start(
      ({ finished }) => finished && !visible && onHidden(),
    );
  }, [visible]);
  return (
    <Animated.View style={{ height, overflow: "hidden" }}>
      <View
        accessibilityRole="alert"
        accessibilityLabel={`The ${cliCommand()} command is controlling ${cliProduct()}`}
        style={{
          height: BAR_HEIGHT,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingLeft: 12,
          paddingRight: 8,
          borderBottomWidth: 0.5,
          borderBottomColor: theme.dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)",
        }}
      >
        <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: theme.textPrimary, alignItems: "center", justifyContent: "center" }}>
          <Symbol name="terminal.fill" size={9} weight="bold" color={theme.dark ? "#000000" : "#FFFFFF"} style={{ width: 14, height: 14 }} />
        </View>
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: theme.textSecondary }}>
          <Text style={{ fontWeight: "600", color: theme.textPrimary }}>{`The ${cliCommand()} command`}</Text>
          {` is controlling ${cliProduct()}`}
        </Text>
        <PromptButton title="Stop" onPress={stopCliControl} />
      </View>
    </Animated.View>
  );
}

export function CliControlPill() {
  const controlled = useControlled();
  if (!controlled) return null;
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", top: 12, left: 0, right: 0, alignItems: "center" }}>
      <View
        accessibilityRole="alert"
        accessibilityLabel={`The ${cliCommand()} command is controlling ${cliProduct()}`}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          height: 32,
          paddingLeft: 12,
          paddingRight: 4,
          borderRadius: 16,
          backgroundColor: "rgba(20,20,20,0.82)",
          borderWidth: 0.5,
          borderColor: "rgba(255,255,255,0.16)",
        }}
      >
        <Symbol name="terminal.fill" size={10} weight="semibold" color="#FFFFFF" style={{ width: 14, height: 14 }} />
        <Text numberOfLines={1} style={{ fontSize: 12, color: "rgba(255,255,255,0.85)" }}>
          <Text style={{ fontWeight: "600", color: "#FFFFFF" }}>{cliCommand()}</Text>
          {` is controlling ${cliProduct()}`}
        </Text>
        <StopPill />
      </View>
    </View>
  );
}

function StopPill() {
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps}>
      <Pressable onPress={stopCliControl} accessibilityRole="button" accessibilityLabel="Stop">
        {({ pressed }) => (
          <View
            style={{
              height: 24,
              paddingHorizontal: 10,
              borderRadius: 12,
              justifyContent: "center",
              backgroundColor: hovered ? "rgba(255,255,255,0.24)" : "rgba(255,255,255,0.16)",
              transform: [{ scale: pressed ? 0.97 : 1 }],
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: "600", color: "#FFFFFF" }}>Stop</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}
