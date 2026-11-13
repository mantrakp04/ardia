import { useRef } from "react";
import { View } from "react-native";
import { useInputRegion } from "./shellAbove";
import { SelectionPopover as BrowserSelectionPopover } from "../../browser/src/components/site/SelectionPopover";

export function SelectionPopover(props: React.ComponentProps<typeof BrowserSelectionPopover>) {
  const wrapper = useRef<View & Element>(null);
  useInputRegion(wrapper, "hit");
  return (
    <View ref={wrapper} testID="ardia-page-overlay" pointerEvents="box-none" style={{ position: "absolute", inset: 0 }}>
      <BrowserSelectionPopover {...props} />
    </View>
  );
}
