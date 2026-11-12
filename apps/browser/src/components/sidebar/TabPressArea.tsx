import { type ReactNode, useRef } from "react";
import { Pressable, type StyleProp, type ViewStyle } from "react-native";
import type { Tab } from "../../state/browser/types";
import { middleClickTab } from "../../state/sidebar/clearTabs";
import { dismissHover } from "../../state/sidebar/hover";
import { openTabMenu } from "../../state/sidebar/menus";
import { clickHeldTabPress, holdTabPress, pressOutTabPress, type TabPress } from "../../state/sidebar/heldTabPress";
import { ContextMenuArea, MouseArea } from "../ui";

export function TabPressArea({
  windowId,
  tab,
  style,
  pressStyle,
  tooltip,
  children,
}: {
  windowId: string;
  tab: Tab;
  style?: StyleProp<ViewStyle>;
  pressStyle?: StyleProp<ViewStyle>;
  tooltip?: string;
  children: ReactNode | ((state: { pressed: boolean }) => ReactNode);
}) {
  const press = useRef<TabPress | null>(null);
  return (
    <MouseArea onMiddleClick={() => middleClickTab(tab.id)} style={style}>
      <ContextMenuArea
        onContextMenu={() => {
          dismissHover();
          void openTabMenu(windowId, tab);
        }}
        style={style}
      >
        <Pressable
          onPressIn={(e) => {
            press.current = holdTabPress(windowId, tab.id, e);
          }}
          onPress={(e) => clickHeldTabPress(windowId, tab.id, e, press.current)}
          onPressOut={(e) => pressOutTabPress(press.current, e)}
          style={pressStyle}
          tooltip={tooltip}
        >
          {children}
        </Pressable>
      </ContextMenuArea>
    </MouseArea>
  );
}
