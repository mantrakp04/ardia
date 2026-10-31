import { View } from "react-native";
import { HoverCard as BrowserHoverCard } from "../../browser/src/components/sidebar/HoverCard";

export function HoverCard(props: React.ComponentProps<typeof BrowserHoverCard>) {
  return (
    <View testID="ardia-sidebar-hover" pointerEvents="box-none" style={{ position: "absolute", inset: 0 }}>
      <BrowserHoverCard {...props} />
    </View>
  );
}
