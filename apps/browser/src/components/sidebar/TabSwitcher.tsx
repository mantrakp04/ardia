import { memo, useEffect, useSyncExternalStore } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { tabTitle } from "../../state/browser/model";
import { useBrowser } from "../../state/browser/store";
import { useSidebarUi } from "../../state/sidebar/sidebarUi";
import { lastPicture, onPicturesChanged } from "../../state/tabs/tabPictures";
import { commitSwitcher, hoverSwitcherRow, leaveSwitcherRow, subscribeSwitcherTabChanges } from "../../state/sidebar/switcher";
import { Symbol, Text, Panel } from "../ui";
import { useTheme } from "../ui/theme";
import { TabIcon } from "./TabIcon";
import { SIDEBAR_SHADOW } from "./tokens";

const CARD = 168;
const SHOT = Math.round(CARD / 1.6);
const GAP = 4;
const PAD = 8;
const LABEL = 30;
const PREVIEW_RADIUS = 8;
const ON_PANEL = "#FFFFFFB3";
const ON_PAGE = "#000000A6";

export function TabSwitcher({ windowId, windowWidth, windowHeight }: { windowId: string; windowWidth: number; windowHeight: number }) {
  const theme = useTheme();
  const pendingSwitcher = useSidebarUi((u) => (u.switcher?.windowId === windowId ? u.switcher : null));
  const switcher = pendingSwitcher?.visible ? pendingSwitcher : null;

  useEffect(() => {
    if (!pendingSwitcher) return;
    return subscribeSwitcherTabChanges(windowId);
  }, [pendingSwitcher?.windowId, windowId]);

  if (!switcher) return null;
  const fits = Math.max(1, Math.floor((windowWidth - 80 - 2 * PAD + GAP) / (CARD + GAP)));
  const count = Math.min(fits, switcher.ids.length);
  const start = Math.max(0, Math.min(switcher.index - Math.floor(count / 2), switcher.ids.length - count));
  const ids = switcher.ids.slice(start, start + count);
  const width = 2 * PAD + count * CARD + (count - 1) * GAP;
  const height = 2 * PAD + SHOT + LABEL + 8;

  return (
    <View
      style={{
        position: "absolute",
        left: (windowWidth - width) / 2,
        top: (windowHeight - height) / 2,
        width,
        height,
      }}
    >
      <Panel
        fill={theme.dark ? "#1C1C1EF2" : "#2A2A2CF2"}
        radius={18}
        border={theme.panelBorder}
        shadow={{ ...SIDEBAR_SHADOW.tabSwitcher, opacity: 0.45, radius: 32, offset: [0, 14] }}
        style={StyleSheet.absoluteFill}
      />
      <View style={{ flexDirection: "row", gap: GAP, padding: PAD }}>
        {ids.map((id, i) => (
          <SwitcherCard key={id} tabId={id} index={start + i} focused={start + i === switcher.index} accent={theme.accent} />
        ))}
      </View>
    </View>
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
      >
        <View style={{ width: CARD, padding: 4, borderRadius: 12, backgroundColor: focused ? "rgba(255,255,255,0.14)" : undefined }}>
          <View
            style={{
              width: CARD - 8,
              height: SHOT,
              borderRadius: PREVIEW_RADIUS,
              overflow: "hidden",
              backgroundColor: url ? "#FFFFFF" : "#3A3A3C",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {picture ? (
              <Image
                source={{ uri: `data:image/jpeg;base64,${picture.data}` }}
                resizeMode="cover"
                style={[StyleSheet.absoluteFill, { borderRadius: PREVIEW_RADIUS }]}
              />
            ) : (
              <TabIcon tabId={tab.id} url={url} favicon={tab.favicon} icon={tab.customIcon} profileId={tab.profileId} size={30} color={url ? ON_PAGE : ON_PANEL} />
            )}
            <View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                {
                  borderRadius: PREVIEW_RADIUS,
                  borderWidth: focused ? 2 : 1,
                  borderColor: focused ? accent : "rgba(255,255,255,0.12)",
                },
              ]}
            />
          </View>
          <View style={{ height: LABEL, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 2 }}>
            {url || tab.customIcon ? (
              <TabIcon tabId={tab.id} url={url} favicon={tab.favicon} icon={tab.customIcon} profileId={tab.profileId} size={13} color={ON_PANEL} />
            ) : (
              <Symbol name="globe" size={12} color={ON_PANEL} style={{ width: 13, height: 13 }} />
            )}
            <Text lines={1} weight="semibold" color="#FFFFFF" style={{ flex: 1, fontSize: 12 }}>
              {tabTitle(tab)}
            </Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
});
