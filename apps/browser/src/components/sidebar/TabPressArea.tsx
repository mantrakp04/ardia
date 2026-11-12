import { useRef, type ReactNode } from "react";
import { Pressable, type StyleProp, type View, type ViewStyle } from "react-native";
import type { Tab } from "../../state/browser/types";
import { middleClickTab } from "../../state/sidebar/clearTabs";
import { dismissHover } from "../../state/sidebar/hover";
import { openTabMenu } from "../../state/sidebar/menus";
import { clickHeldTabPress, holdTabPress } from "../../state/sidebar/heldTabPress";
import { ContextMenuArea, MouseArea } from "../ui";
import { modifiersOf } from "../../lib/keys";

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
  const focus = useRef<View>(null);
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
          ref={focus}
          onPressIn={(e) => {
            holdTabPress(windowId, tab.id, e);
            const mods = modifiersOf(e);
            if (mods.metaKey || (mods.shiftKey && !mods.altKey)) focus.current?.focus();
          }}
          onPress={(e) => clickHeldTabPress(windowId, tab.id, e)}
          style={pressStyle}
          tooltip={tooltip}
        >
          {children}
        </Pressable>
      </ContextMenuArea>
    </MouseArea>
  );
}
