import { useEffect, useRef, useState } from "react";
import { BackHandler, Modal, Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { tabsMotion } from "./motion";
import { Symbol } from "./Symbol";
import type { SymbolName } from "./symbolPaths";
import { useTheme } from "./theme";
import { font, ink, radius, space } from "./tokens";

export type MenuItem = { label: string; icon?: SymbolName; destructive?: boolean; checked?: boolean; onPress: () => void } | "divider" | { heading: string };

type Props = { items: MenuItem[]; place: ViewStyle; onDismiss: () => void };

export function Menu({ items, place, onDismiss }: Props) {
  const theme = useTheme();
  useEffect(() => {
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      onDismiss();
      return true;
    });
    return () => back.remove();
  }, [onDismiss]);
  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable accessibilityLabel="Dismiss" style={[StyleSheet.absoluteFill, { backgroundColor: ink.clear }]} onPress={onDismiss} />
      <Animated.View
        entering={FadeIn.duration(tabsMotion.menu)}
        style={[styles.panel, place, { backgroundColor: theme.panel, shadowColor: theme.trayShadow }]}
      >
        {items.map((item, index) => {
          if (item === "divider") return <View key={`d${index}`} style={[styles.divider, { backgroundColor: theme.divider }]} />;
          if ("heading" in item)
            return (
              <Text key={`h${index}`} style={[font.footnote, styles.heading, { color: theme.secondaryLabel }]}>
                {item.heading}
              </Text>
            );
          const color = item.destructive ? theme.destructive : theme.label;
          return (
            <Pressable
              key={`${index}:${item.label}`}
              accessibilityRole="menuitem"
              accessibilityLabel={item.label}
              accessibilityState={{ checked: item.checked }}
              onPress={() => {
                onDismiss();
                item.onPress();
              }}
              style={({ pressed }) => [styles.row, pressed ? { backgroundColor: theme.rowHighlight } : null]}
            >
              <Text style={[font.body, styles.label, { color }]}>{item.label}</Text>
              {item.checked ? <Symbol name="checkmark" size={18} color={theme.formAccent} /> : null}
              {item.icon ? <Symbol name={item.icon} size={18} color={color} /> : null}
            </Pressable>
          );
        })}
      </Animated.View>
    </View>
  );
}

export function FloatingMenu(props: Props) {
  const frame = useRef<View>(null);
  const [origin, setOrigin] = useState<number | null>(null);
  const place = props.place;
  const shifted: ViewStyle =
    origin === null
      ? place
      : {
          ...place,
          ...(typeof place.top === "number" ? { top: place.top - origin } : {}),
          ...(typeof place.bottom === "number" ? { bottom: place.bottom + origin } : {}),
        };
  return (
    <Modal transparent statusBarTranslucent navigationBarTranslucent animationType="none" onRequestClose={props.onDismiss}>
      <View
        ref={frame}
        style={StyleSheet.absoluteFill}
        collapsable={false}
        onLayout={() => frame.current?.measureInWindow((_x, y) => setOrigin(y))}
      >
        {origin === null ? null : <Menu {...props} place={shifted} />}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  panel: { position: "absolute", minWidth: 230, borderRadius: radius.row, paddingVertical: space.xs, elevation: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: space.m, paddingHorizontal: space.l, minHeight: 46 },
  label: { flex: 1 },
  heading: { paddingHorizontal: space.l, paddingVertical: space.xs + 2 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: space.xs },
});
