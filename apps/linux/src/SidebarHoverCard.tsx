import { useRef } from "react";
import { View } from "react-native";
import { useInputRegion } from "./shellAbove";
import { GlassOptIn } from "./shellGlass";
import { HoverCard as BrowserHoverCard } from "../../browser/src/components/sidebar/HoverCard";

export function HoverCard(props: React.ComponentProps<typeof BrowserHoverCard>) {
  const wrapper = useRef<View & Element>(null);
  useInputRegion(wrapper, "hit");
  return (
    <View ref={wrapper} testID="ardia-sidebar-hover" pointerEvents="box-none" style={{ position: "absolute", inset: 0 }}>
      <GlassOptIn.Provider value={true}>
        <BrowserHoverCard {...props} />
      </GlassOptIn.Provider>
    </View>
  );
}
