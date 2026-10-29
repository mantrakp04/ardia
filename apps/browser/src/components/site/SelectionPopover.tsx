import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "../ui/theme";
import { useSettings } from "../../state/browser/hooks";
import { defaultSearchEngine } from "../../state/settings/settings";
import { menuRowFill, Panel, POPOVER_MOTION, Symbol, Text, useHover, VisualEffect } from "../ui";
import { searchSelection, setPageSelection, usePageSelection, type ClickModifiers, type PageSelection } from "../../state/site/selection";
import { selectionBar } from "./tokens";

const HEIGHT = 32;
const GAP = 6;

export function SelectionPopover({ tabId, zoom }: { tabId: string; zoom: number }) {
  const enabled = useSettings((st) => st.showSelectionSearch);
  const selection = usePageSelection((s) => (enabled ? (s[tabId] ?? null) : null));
  const [shown, setShown] = useState<PageSelection | null>(null);
  const [area, setArea] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!selection) return setShown(null);
    const timer = setTimeout(() => setShown(selection), selectionBar.showDelay);
    return () => clearTimeout(timer);
  }, [selection]);
  useEffect(() => () => setPageSelection(tabId, null), [tabId]);
  if (!selection && !shown) return null;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill} onLayout={(e) => setArea(e.nativeEvent.layout)}>
      {shown && area.width > 0 && <Bar key={`${shown.rect.x},${shown.rect.y}`} tabId={tabId} selection={shown} zoom={zoom} area={area} />}
    </View>
  );
}

function Bar({ tabId, selection, zoom, area }: { tabId: string; selection: PageSelection; zoom: number; area: { width: number; height: number } }) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const appear = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(appear, { toValue: 1, ...POPOVER_MOTION.open, useNativeDriver: true }).start();
  }, []);
  const r = selection.rect;
  const top = r.y * zoom;
  const bottom = (r.y + r.height) * zoom;
  if (bottom < 0 || top > area.height) return null;
  const above = top - GAP - HEIGHT >= 4;
  const y = above ? top - GAP - HEIGHT : Math.min(bottom + GAP, area.height - HEIGHT - 4);
  const center = (r.x + r.width / 2) * zoom;
  const x = Math.max(8, Math.min(center - width / 2, area.width - width - 8));

  return (
    <Animated.View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{
        position: "absolute",
        left: x,
        top: y,
        opacity: width ? appear : 0,
        transformOrigin: above ? "center bottom" : "center top",
        transform: [
          { scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
          { translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [above ? 3 : -3, 0] }) },
        ],
      }}
    >
      <Panel fill={theme.popoverFill} radius={selectionBar.radius} border={theme.popoverBorder} shadow={selectionBar.shadow} style={{ height: HEIGHT, padding: 3, flexDirection: "row", alignItems: "center" }}>
        <VisualEffect material="menu" cornerRadius={selectionBar.radius} style={StyleSheet.absoluteFill} />
        <View style={{ ...StyleSheet.absoluteFillObject, borderRadius: selectionBar.radius, backgroundColor: theme.popoverTint }} />
        <SearchButton tabId={tabId} text={selection.text} />
      </Panel>
    </Animated.View>
  );
}

function SearchButton({ tabId, text }: { tabId: string; text: string }) {
  const theme = useTheme();
  const engine = useSettings((st) => defaultSearchEngine(st).name);
  const { hovered, hoverProps } = useHover();
  const quoted = text.length > 40 ? `${text.slice(0, 40).trimEnd()}…` : text;
  return (
    <View {...hoverProps} tooltip={`Search ${engine} for “${quoted.replace(/\s+/g, " ")}”`}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Search ${engine}`} onPress={(e) => searchSelection(tabId, text, e.nativeEvent as unknown as ClickModifiers)}>
        {({ pressed }) => (
          <View
            style={{
              height: HEIGHT - 6,
              paddingLeft: 7,
              paddingRight: 9,
              borderRadius: 7,
              flexDirection: "row",
              alignItems: "center",
              gap: 5,
              backgroundColor: pressed || hovered ? menuRowFill(theme, pressed) : undefined,
            }}
          >
            <Symbol name="magnifyingglass" size={12} weight="medium" color={theme.icon} style={{ width: 16, height: 16 }} />
            <Text weight="medium">Search</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}
