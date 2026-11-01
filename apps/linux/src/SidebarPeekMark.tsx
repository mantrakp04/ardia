import { useRef } from "react";
import { StyleSheet, View } from "react-native";
import { useInputRegion } from "./shellAbove";
import { Sidebar as BrowserSidebar } from "../../browser/src/components/sidebar/Sidebar";
import { useWindowId } from "../../browser/src/state/browser/hooks";
import { usePeekSpan } from "../../browser/src/state/windows/dockMotion";

export function Sidebar(props: React.ComponentProps<typeof BrowserSidebar>) {
  const peeking = usePeekSpan(useWindowId()) !== undefined;
  return (
    <>
      <BrowserSidebar {...props} />
      {peeking && <PeekMark />}
    </>
  );
}

function PeekMark() {
  const mark = useRef<View & Element>(null);
  useInputRegion(mark);
  return <View ref={mark} testID="ardia-sidebar-peek" pointerEvents="none" style={StyleSheet.absoluteFill} />;
}
