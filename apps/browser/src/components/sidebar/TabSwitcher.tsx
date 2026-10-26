import { useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import { displayUrl } from "@ardia/core";
import { FadeLabel, font, Panel, radius, weight } from "../ui";
import { useTheme } from "../ui/theme";
import { useTab } from "../../state/browser/hooks";
import { tabTitle } from "../../state/sidebar/actions";
import { useSidebarUi } from "../../state/sidebar/sidebarUi";
import { commitSwitcher, hoverSwitcherRow, leaveSwitcherRow } from "../../state/sidebar/switcher";
import { TabIcon } from "./TabIcon";
import { SIDEBAR_SHADOW, useSidebarTokens } from "./tokens";

const WIDTH = 400;
const ROW = 40;
const MAX_ROWS = 9;
const SWITCHER_RADIUS = 16;

export function TabSwitcher({ windowId, windowWidth, windowHeight }: { windowId: string; windowWidth: number; windowHeight: number }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const switcher = useSidebarUi((u) => (u.switcher?.windowId === windowId && u.switcher.visible ? u.switcher : null));
  if (!switcher) return null;
  const start = Math.max(0, Math.min(switcher.index - Math.floor(MAX_ROWS / 2), switcher.ids.length - MAX_ROWS));
  const shown = switcher.ids.slice(start, start + MAX_ROWS);
  const height = shown.length * ROW + 16 + 26;
  return (
    <Panel
      fill={theme.panel}
      radius={SWITCHER_RADIUS}
      border={theme.panelBorder}
      shadow={SIDEBAR_SHADOW.tabSwitcher}
      style={{ position: "absolute", left: (windowWidth - WIDTH) / 2, top: Math.max(40, (windowHeight - height) / 2 - 40), width: WIDTH, padding: 8 }}
    >
      <Text style={{ ...font.caption, fontWeight: weight.semibold, color: theme.textTertiary, paddingHorizontal: 8, paddingBottom: 6, paddingTop: 2 }}>Recent Tabs</Text>
      {shown.map((id, i) => (
        <SwitcherRow key={id} tabId={id} focused={start + i === switcher.index} index={start + i} focusFill={tokens.switcherFocus} outline={tokens.switcherOutline} />
      ))}
    </Panel>
  );
}

function SwitcherRow({ tabId, focused, index, focusFill, outline }: { tabId: string; focused: boolean; index: number; focusFill: string; outline: string }) {
  const theme = useTheme();
  const tab = useTab(tabId);
  useEffect(() => () => leaveSwitcherRow(index), [index]);
  if (!tab) return null;
  return (
    <Pressable onPressIn={() => commitSwitcher(index)}>
      <View
        onMouseEnter={() => hoverSwitcherRow(index)}
        onMouseLeave={() => leaveSwitcherRow(index)}
        style={{
          height: ROW,
          borderRadius: radius.card,
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 10,
          gap: 10,
          backgroundColor: focused ? focusFill : undefined,
          borderWidth: focused ? 0.5 : 0,
          borderColor: outline,
        }}
      >
        <TabIcon url={tab.url} favicon={tab.favicon} icon={tab.customIcon} size={18} profileId={tab.profileId} />
        <View style={{ flex: 1 }}>
          <FadeLabel text={tabTitle(tab)} fontSize={font.body.fontSize} weight={focused ? "medium" : "regular"} color={theme.textPrimary} style={{ height: 17 }} />
          {tab.url ? <FadeLabel text={displayUrl(tab.url)} fontSize={font.caption.fontSize} color={theme.textSecondary} style={{ height: 14 }} /> : null}
        </View>
      </View>
    </Pressable>
  );
}
