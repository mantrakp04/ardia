import { Symbol } from "@ardia/shell";
import { useMemo } from "react";
import { Animated, Text } from "react-native";
import { useWindowId } from "../../store/hooks";
import { pagerFor, usePageStyle } from "../layout/profilePager";
import { useSidebarTokens } from "./tokens";

export function NewProfilePage({ slot, width }: { slot: number; width: number }) {
  const windowId = useWindowId();
  const tokens = useSidebarTokens();
  const pageStyle = usePageStyle(windowId, slot, width);
  const { pos, state } = pagerFor(windowId);
  const fromLast = state((s) => s.fromLast);
  const centredInReveal = useMemo(
    () => ({ transform: [{ translateX: pos.interpolate({ inputRange: [slot - 1, slot], outputRange: [-width / 2, 0], extrapolate: "clamp" }) }] }),
    [pos, slot, width],
  );
  if (!fromLast) return null;
  return (
    <Animated.View pointerEvents="none" style={{ position: "absolute", top: 0, bottom: 0, left: 0, width, overflow: "hidden", ...pageStyle }}>
      <Animated.View style={[{ flex: 1, alignItems: "center", justifyContent: "center", gap: 6 }, centredInReveal]}>
        <Symbol name="plus" size={15} weight="medium" color={tokens.newTabIcon} style={{ width: 18, height: 18 }} />
        <Text style={{ fontSize: 13, color: tokens.newTabLabel }}>New Profile</Text>
      </Animated.View>
    </Animated.View>
  );
}
