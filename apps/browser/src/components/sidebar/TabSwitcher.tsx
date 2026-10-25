import { Surface, Symbol } from "@ardia/shell";
import { memo, useEffect, useRef, useSyncExternalStore } from "react";
import { Animated, Easing, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { lastPicture, onPicturesChanged } from "../../lib/tabPictures";
import { hex, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { TabIcon } from "./TabIcon";
import { tabTitle } from "./actions";
import { useSidebarUi } from "./state";
import { commitSwitcher, hoverSwitcherRow, leaveSwitcherRow } from "./switcher";

const CARD = 168;
const SHOT = Math.round(CARD / 1.6);
const GAP = 4;
const PAD = 8;
const LABEL = 30;

export function TabSwitcher({ windowId, windowWidth, windowHeight }: { windowId: string; windowWidth: number; windowHeight: number }) {
  const theme = useTheme();
  const switcher = useSidebarUi((u) => (u.switcher?.windowId === windowId && u.switcher.visible ? u.switcher : null));
  const appear = useRef(new Animated.Value(0)).current;
  const shown = !!switcher;
  useEffect(() => {
    if (!shown) return appear.setValue(0);
    Animated.timing(appear, { toValue: 1, duration: 160, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [shown]);
  if (!switcher) return null;
  const fits = Math.max(1, Math.floor((windowWidth - 80 - 2 * PAD + GAP) / (CARD + GAP)));
  const count = Math.min(fits, switcher.ids.length);
  const start = Math.max(0, Math.min(switcher.index - Math.floor(count / 2), switcher.ids.length - count));
  const ids = switcher.ids.slice(start, start + count);
  const width = 2 * PAD + count * CARD + (count - 1) * GAP;
  const height = 2 * PAD + SHOT + LABEL + 8;
  return (
    <Animated.View
      style={{
        position: "absolute",
        left: (windowWidth - width) / 2,
        top: (windowHeight - height) / 2,
        width,
        height,
        opacity: appear,
        transform: [{ scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }],
      }}
    >
      <Surface
        fill={theme.dark ? "#1C1C1EF2" : "#2A2A2CF2"}
        cornerRadius={18}
        borderColor={hex(theme.panelBorder)}
        borderWidth={0.5}
        shadowColor="#000000"
        shadowOpacity={0.45}
        shadowRadius={32}
        shadowOffset={[0, 14]}
        style={StyleSheet.absoluteFill}
      />
      <View style={{ flexDirection: "row", gap: GAP, padding: PAD }}>
        {ids.map((id, i) => (
          <SwitcherCard key={id} tabId={id} index={start + i} focused={start + i === switcher.index} accent={theme.accent} />
        ))}
      </View>
    </Animated.View>
  );
}

const SwitcherCard = memo(function SwitcherCard({ tabId, index, focused, accent }: { tabId: string; index: number; focused: boolean; accent: string }) {
  const tab = useBrowser((s) => s.tabs[tabId]);
  const picture = useSyncExternalStore(onPicturesChanged, () => lastPicture(tabId));
  useEffect(() => () => leaveSwitcherRow(index), [index]);
  if (!tab) return null;
  const url = tab.url || tab.pinnedUrl || "";
  return (
    <Pressable onPressIn={() => commitSwitcher(index)}>
      <View
        onMouseEnter={() => hoverSwitcherRow(index)}
        onMouseLeave={() => leaveSwitcherRow(index)}
        style={{ width: CARD, padding: 4, borderRadius: 12, backgroundColor: focused ? "rgba(255,255,255,0.14)" : undefined }}
      >
        <View
          style={{
            width: CARD - 8,
            height: SHOT,
            borderRadius: 8,
            overflow: "hidden",
            backgroundColor: url ? "#FFFFFF" : "#3A3A3C",
            alignItems: "center",
            justifyContent: "center",
            borderWidth: focused ? 2 : 0.5,
            borderColor: focused ? accent : "rgba(255,255,255,0.12)",
          }}
        >
          {picture ? (
            <Image source={{ uri: `data:image/jpeg;base64,${picture.data}` }} resizeMode="cover" style={StyleSheet.absoluteFill} />
          ) : (
            <TabIcon tabId={tab.id} url={url} favicon={tab.favicon} icon={tab.customIcon} profileId={tab.profileId} size={30} />
          )}
        </View>
        <View style={{ height: LABEL, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 2 }}>
          {url || tab.customIcon ? (
            <TabIcon tabId={tab.id} url={url} favicon={tab.favicon} icon={tab.customIcon} profileId={tab.profileId} size={13} />
          ) : (
            <Symbol name="globe" size={12} color="#FFFFFFB3" style={{ width: 13, height: 13 }} />
          )}
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 12, fontWeight: "600", color: "#FFFFFF" }}>
            {tabTitle(tab)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
});
