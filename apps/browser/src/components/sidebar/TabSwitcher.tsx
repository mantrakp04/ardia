import { tabTitle } from "../../state/browser/model";
import { useEffect } from "react";
import { Pressable, View } from "react-native";
import { displayUrl } from "@ardia/core";
import { concentric, FadeLabel, font, hairline, Panel, radius, space } from "../ui";
import { SectionLabel } from "./SectionLabel";
import { useTheme } from "../ui/theme";
import { useTab } from "../../state/browser/hooks";
import { useSidebarUi } from "../../state/sidebar/sidebarUi";
import { commitSwitcher, hoverSwitcherRow, leaveSwitcherRow } from "../../state/sidebar/switcher";
import { TabIcon } from "./TabIcon";
import { SIDEBAR_SHADOW, useSidebarTokens } from "./tokens";

const WIDTH = 400;
const ROW = 40;
const MAX_ROWS = 9;
const SWITCHER_RADIUS = radius.sheet;
const SWITCHER_PAD = space.m;
const ROW_RADIUS = concentric(SWITCHER_RADIUS, SWITCHER_PAD);

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
      style={{ position: "absolute", left: (windowWidth - WIDTH) / 2, top: Math.max(40, (windowHeight - height) / 2 - 40), width: WIDTH, padding: SWITCHER_PAD }}
    >
      <SectionLabel title="Recent Tabs" inset={space.m} top={space.xxs} bottom={space.s} />
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
          borderRadius: ROW_RADIUS,
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: space.ml,
          gap: space.ml,
          backgroundColor: focused ? focusFill : undefined,
          borderWidth: focused ? hairline.ring : 0,
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
