import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useWindowId } from "../../state/browser/hooks";
import { startSidebarEffects } from "../../state/sidebar/effects";
import { MeetingAlert } from "../live/MeetingAlert";
import { HoverCard } from "./HoverCard";
import { IconPicker } from "./IconPicker";
import { ProfileIconPicker } from "../profiles/ProfileIconPicker";
import { SearchTabs } from "./SearchTabs";
import { TabSwitcher } from "./TabSwitcher";
import { useSidebarWidth } from "../../state/sidebar/hooks";
import { sameSize, useSettled, type Size } from "../ui/useSettled";

export function SidebarOverlays({ windowWidth }: { windowWidth: number }) {
  const windowId = useWindowId();
  const sidebarWidth = useSidebarWidth(windowId);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const settleSize = useSettled((next: Size) => setSize((prev) => (sameSize(prev, next) ? prev : next)));
  useEffect(startSidebarEffects, []);
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill} onLayout={(e) => settleSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}>
      <HoverCard windowId={windowId} width={size.width} height={size.height} />
      <MeetingAlert windowId={windowId} windowWidth={windowWidth} />
      <IconPicker windowId={windowId} sidebarWidth={sidebarWidth} />
      <ProfileIconPicker windowId={windowId} />
      <SearchTabs windowId={windowId} windowWidth={windowWidth} />
      <TabSwitcher windowId={windowId} windowWidth={windowWidth} windowHeight={size.height} />
    </View>
  );
}
