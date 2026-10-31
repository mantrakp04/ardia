import { StyleSheet, View } from "react-native";
import { Sidebar as BrowserSidebar } from "../../browser/src/components/sidebar/Sidebar";
import { useWindowId } from "../../browser/src/state/browser/hooks";
import { usePeekEdge } from "../../browser/src/state/windows/dockMotion";

export function Sidebar(props: React.ComponentProps<typeof BrowserSidebar>) {
  const peeking = usePeekEdge(useWindowId()) !== undefined;
  return (
    <>
      <BrowserSidebar {...props} />
      {peeking && <View testID="ardia-sidebar-peek" pointerEvents="none" style={StyleSheet.absoluteFill} />}
    </>
  );
}
