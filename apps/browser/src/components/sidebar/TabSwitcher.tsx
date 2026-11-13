import { useInterfaceMetrics } from "../ui/interfaceSize";
import { scaleMetrics } from "../../lib/interfaceMetrics";
import { memo, useEffect, useMemo, useSyncExternalStore } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { tabTitle } from "../../state/browser/model";
import { useTab } from "../../state/browser/hooks";
import { useSidebarUi } from "../../state/sidebar/sidebarUi";
import { lastPicture, onPicturesChanged } from "../../state/tabs/tabPictures";
import { commitSwitcher, hoverSwitcherRow, leaveSwitcherRow, subscribeSwitcherTabChanges } from "../../state/sidebar/switcher";
import { Symbol, Text, Panel } from "../ui";
import { useTheme } from "../ui/theme";
import { TabIcon } from "./TabIcon";
import { SIDEBAR_SHADOW, TAB_SWITCHER as T } from "./tokens";

function useSwitcherMetrics() {
  const { factor } = useInterfaceMetrics();
  return useMemo(() => ({
    ...scaleMetrics(T, factor),
    shotAspect: T.shotAspect,
    titleSize: T.titleSize,
    icon: { ...scaleMetrics(T.icon, factor), globe: T.icon.globe },
    shot: Math.round(T.card / T.shotAspect) * factor,
    shotWidth: (T.card - 2 * T.cardInset) * factor,
  }), [factor]);
}

export function TabSwitcher({ windowId, windowWidth, windowHeight }: { windowId: string; windowWidth: number; windowHeight: number }) {
  const T = useSwitcherMetrics();
  const theme = useTheme();
  const pendingSwitcher = useSidebarUi((u) => (u.switcher?.windowId === windowId ? u.switcher : null));
  const switcher = pendingSwitcher?.visible ? pendingSwitcher : null;

  useEffect(() => {
    if (!pendingSwitcher) return;
    return subscribeSwitcherTabChanges(windowId);
  }, [pendingSwitcher?.windowId, windowId]);

  if (!switcher) return null;
  const fits = Math.max(1, Math.floor((windowWidth - T.windowMargin - 2 * T.pad + T.gap) / (T.card + T.gap)));
  const count = Math.min(fits, switcher.ids.length);
  const start = Math.max(0, Math.min(switcher.index - Math.floor(count / 2), switcher.ids.length - count));
  const ids = switcher.ids.slice(start, start + count);
  const width = 2 * T.pad + count * T.card + (count - 1) * T.gap;
  const height = 2 * T.pad + T.shot + T.label + 2 * T.cardInset;

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
        fill={theme.dark ? T.fill.dark : T.fill.light}
        radius={T.panelRadius}
        border={theme.panelBorder}
        shadow={SIDEBAR_SHADOW.tabSwitcher}
        style={StyleSheet.absoluteFill}
      />
      <View style={{ flexDirection: "row", gap: T.gap, padding: T.pad }}>
        {ids.map((id, i) => (
          <SwitcherCard key={id} tabId={id} index={start + i} focused={start + i === switcher.index} accent={theme.accent} />
        ))}
      </View>
    </View>
  );
}

const SwitcherCard = memo(function SwitcherCard({ tabId, index, focused, accent }: { tabId: string; index: number; focused: boolean; accent: string }) {
  const T = useSwitcherMetrics();
  const tab = useTab(tabId);
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
        <View style={{ width: T.card, padding: T.cardInset, borderRadius: T.cardRadius, backgroundColor: focused ? T.focusFill : undefined }}>
          <View
            style={{
              width: T.shotWidth,
              height: T.shot,
              borderRadius: T.previewRadius,
              overflow: "hidden",
              backgroundColor: url ? T.pageFill : T.blankFill,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {picture ? (
              <Image
                source={{ uri: `data:image/jpeg;base64,${picture.data}` }}
                resizeMode="cover"
                style={[StyleSheet.absoluteFill, { borderRadius: T.previewRadius }]}
              />
            ) : (
              <TabIcon tabId={tab.id} url={url} favicon={tab.favicon} icon={tab.customIcon} profileId={tab.profileId} size={T.icon.preview} color={url ? T.onPage : T.onPanel} />
            )}
            <View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                {
                  borderRadius: T.previewRadius,
                  borderWidth: focused ? T.ring.focused : T.ring.rest,
                  borderColor: focused ? accent : T.restRing,
                },
              ]}
            />
          </View>
          <View style={{ height: T.label, flexDirection: "row", alignItems: "center", gap: T.labelGap, paddingHorizontal: T.labelInset }}>
            {url || tab.customIcon ? (
              <TabIcon tabId={tab.id} url={url} favicon={tab.favicon} icon={tab.customIcon} profileId={tab.profileId} size={T.icon.label} color={T.onPanel} />
            ) : (
              <Symbol name="globe" size={T.icon.globe} color={T.onPanel} style={{ width: T.icon.label, height: T.icon.label }} />
            )}
            <Text lines={1} weight="semibold" color={T.title} style={{ flex: 1, fontSize: T.titleSize }}>
              {tabTitle(tab)}
            </Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
});
