import { useEffect, useRef, useState, type RefObject } from "react";
import { BackHandler, Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { MENU_ROW, menuHeight, menuTop } from "../../lib/menuPlace";
import { useCoverFocus } from "./coverFocus";
import { measureAnchor, Portal, useOverlayFrame } from "./Overlay";
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
  const panel = useRef<View>(null);
  useCoverFocus(panel);
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
        ref={panel}
        accessibilityViewIsModal
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

const MENU_MARGIN = 8;

export function FloatingMenu({ items, place, onDismiss, anchor }: Props & { anchor?: RefObject<View | null> }) {
  const hostFrame = useOverlayFrame();
  const [placed, setPlaced] = useState<ViewStyle | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.all([hostFrame(), anchor ? measureAnchor(anchor) : Promise.resolve(null)]).then(([host, row]) => {
      if (!live) return;
      if (row && row.height > 0) {
        const { top: _top, bottom: _bottom, ...across } = place;
        setPlaced({ ...across, top: menuTop(row, host, menuHeight(items), MENU_MARGIN) });
      } else if (typeof place.top === "number") {
        setPlaced({ ...place, top: Math.max(MENU_MARGIN, Math.min(place.top - host.y, host.height - menuHeight(items) - MENU_MARGIN)) });
      } else setPlaced(place);
    });
    return () => {
      live = false;
    };
  }, []);
  return placed ? (
    <Portal>
      <Menu items={items} place={placed} onDismiss={onDismiss} />
    </Portal>
  ) : null;
}

const styles = StyleSheet.create({
  panel: { position: "absolute", minWidth: 230, borderRadius: radius.row, paddingVertical: space.xs, elevation: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: space.m, paddingHorizontal: space.l, minHeight: MENU_ROW },
  label: { flex: 1 },
  heading: { paddingHorizontal: space.l, paddingVertical: space.xs + 2 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: space.xs },
});
