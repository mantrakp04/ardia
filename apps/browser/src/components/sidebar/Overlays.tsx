import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useWindowId } from "../../state/browser/hooks";
import { startSidebarEffects } from "../../state/sidebar/effects";
import { MeetingAlert } from "../live/MeetingAlert";
import { HoverCard } from "./HoverCard";
import { IconPicker } from "./IconPicker";
import { SearchTabs } from "./SearchTabs";
import { TabSwitcher } from "./TabSwitcher";
import { useSidebarWidth } from "../../state/sidebar/hooks";

export function SidebarOverlays({ windowWidth }: { windowWidth: number }) {
  const windowId = useWindowId();
  const sidebarWidth = useSidebarWidth(windowId);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(startSidebarEffects, []);
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill} onLayout={(e) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}>
      <HoverCard windowId={windowId} width={size.width} height={size.height} />
      <MeetingAlert windowId={windowId} windowWidth={windowWidth} />
      <IconPicker windowId={windowId} sidebarWidth={sidebarWidth} />
      <SearchTabs windowId={windowId} windowWidth={windowWidth} />
      <TabSwitcher windowId={windowId} windowWidth={windowWidth} windowHeight={size.height} />
    </View>
  );
}
