import type { ReactNode } from "react";
import { Pressable, type StyleProp, type ViewStyle } from "react-native";
import type { Tab } from "../../state/browser/types";
import { clickTab } from "../../state/sidebar/actions";
import { middleClickTab } from "../../state/sidebar/clearTabs";
import { dismissHover } from "../../state/sidebar/hover";
import { openTabMenu } from "../../state/sidebar/menus";
import { modifiersOf } from "../../lib/keys";
import { ContextMenuArea, MouseArea } from "../ui";

export function TabPressArea({
  windowId,
  tab,
  style,
  pressStyle,
  tooltip,
  leading,
  children,
}: {
  windowId: string;
  tab: Tab;
  style?: StyleProp<ViewStyle>;
  pressStyle?: StyleProp<ViewStyle>;
  tooltip?: string;
  leading?: ReactNode;
  children: ReactNode | ((state: { pressed: boolean }) => ReactNode);
}) {
  return (
    <MouseArea onMiddleClick={() => middleClickTab(tab.id)} style={style}>
      <ContextMenuArea
        onContextMenu={() => {
          dismissHover();
          void openTabMenu(windowId, tab);
        }}
        style={style}
      >
        {leading}
        <Pressable
          onPress={(e) => {
            dismissHover();
            clickTab(windowId, tab.id, modifiersOf(e));
          }}
          style={pressStyle}
          tooltip={tooltip}
        >
          {children}
        </Pressable>
      </ContextMenuArea>
    </MouseArea>
  );
}
