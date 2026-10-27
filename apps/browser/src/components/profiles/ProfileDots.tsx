import { useState } from "react";
import { Animated, Pressable, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { switchProfile } from "../../state/browser/actions";
import { useTheme } from "../ui/theme";
import { useIsIncognito, useProfile } from "../../state/browser/hooks";
import { useProfileOrder } from "../../state/profiles/hooks";
import { useNativePagerPosition, usePagerPages, type PagerPage } from "../../state/windows/profilePager";
import { useHover } from "../ui";
import { TooltipAbove } from "../ui/TooltipAbove";

export const PROFILE_DOTS_HEIGHT = 41;
const CELL = 12;
const DOT = 6;
const BAND = 28;
const SELECTED = 0.85;
const HOVERED = 0.4;
const IDLE = 0.2;
const DOT_CENTER_TO_TOOLTIP = 18.25;

export function useProfileDotsShown() {
  const incognito = useIsIncognito();
  const count = useProfileOrder((o) => o.length);
  return !incognito && count > 1;
}

export function ProfileDots({ windowId }: { windowId: string }) {
  const ids = useProfileOrder(useShallow((o) => o));
  const { pages, pager } = usePagerPages(windowId);
  return (
    <View style={{ height: PROFILE_DOTS_HEIGHT, alignItems: "center" }}>
      <View style={{ marginTop: (PROFILE_DOTS_HEIGHT - 3 - BAND) / 2, height: BAND, flexDirection: "row" }}>
        {ids.map((id) => (
          <Dot key={id} id={id} windowId={windowId} page={pages.find((p) => p.id === id)} pos={pager.pos} />
        ))}
      </View>
    </View>
  );
}

function Dot({ id, windowId, page, pos }: { id: string; windowId: string; page: PagerPage | undefined; pos: Animated.Value }) {
  const theme = useTheme();
  useNativePagerPosition(windowId);
  const name = useProfile(id, (p) => p?.name ?? "");
  const { hovered, hoverProps } = useHover();
  const [pressed, setPressed] = useState(false);
  if (pressed && !hovered) setPressed(false);
  const rest = hovered ? HOVERED : IDLE;
  const opacity = page
    ? pos.interpolate({ inputRange: [page.slot - 1, page.slot, page.slot + 1], outputRange: [rest, SELECTED, rest], extrapolate: "clamp" })
    : rest;
  return (
    <View {...hoverProps}>
      <TooltipAbove text={name} active={hovered && !pressed} centerX={CELL / 2} bottom={BAND / 2 + DOT_CENTER_TO_TOOLTIP} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={name}
        onPress={() => {
          setPressed(true);
          switchProfile(windowId, id, true);
        }}
      >
        <View style={{ width: CELL, height: BAND, alignItems: "center", justifyContent: "center" }}>
          <Animated.View style={{ width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: theme.mark, opacity }} />
        </View>
      </Pressable>
    </View>
  );
}
