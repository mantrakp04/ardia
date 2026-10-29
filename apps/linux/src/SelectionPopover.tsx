import { View } from "react-native";
import { SelectionPopover as BrowserSelectionPopover } from "../../browser/src/components/site/SelectionPopover";

export function SelectionPopover(props: React.ComponentProps<typeof BrowserSelectionPopover>) {
  return (
    <View testID="ardia-page-overlay" pointerEvents="box-none" style={{ position: "absolute", inset: 0 }}>
      <BrowserSelectionPopover {...props} />
    </View>
  );
}
