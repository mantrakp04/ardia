import { Symbol } from "@ardia/shell";
import { Animated, Pressable, Text, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { switchProfile } from "../../lib/actions";
import { useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useIsIncognito } from "../../store/hooks";
import { usePagerPages, type PagerPage } from "../layout/profilePager";
import { useHover } from "../primitives";
import { profileSymbol } from "./icons";

export const PROFILE_DOTS_HEIGHT = 41;
const CELL = 20;
const DOT = 6;
const BAND = 28;
const SELECTED = 0.85;
const HOVERED = 0.4;
const IDLE = 0.2;

export function useProfileDotsShown() {
  const incognito = useIsIncognito();
  const count = useBrowser((s) => s.profileOrder.length);
  return !incognito && count > 1;
}

export function ProfileDots({ windowId }: { windowId: string }) {
  const ids = useBrowser(useShallow((s) => s.profileOrder));
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
  const profile = useBrowser((s) => s.profiles[id]);
  const name = profile?.name ?? "";
  const symbol = profileSymbol(profile?.icon ?? null);
  const color = theme.dark ? "#FFFFFF" : "#000000";
  const { hovered, hoverProps } = useHover();
  const rest = hovered ? HOVERED : IDLE;
  const opacity = page
    ? pos.interpolate({ inputRange: [page.slot - 1, page.slot, page.slot + 1], outputRange: [rest, SELECTED, rest], extrapolate: "clamp" })
    : rest;
  return (
    <View {...hoverProps} tooltip={name}>
      <Pressable accessibilityRole="button" accessibilityLabel={name} onPress={() => switchProfile(windowId, id, true)}>
        <View style={{ width: CELL, height: BAND, alignItems: "center", justifyContent: "center" }}>
          <Animated.View style={{ opacity }}>
            {symbol ? (
              <Symbol name={symbol} size={9.5} weight="semibold" color={color} style={{ width: 14, height: 14 }} />
            ) : profile?.icon ? (
              <Text style={{ width: 14, height: 14, fontSize: 10.5, lineHeight: 14, textAlign: "center", color }}>{profile.icon}</Text>
            ) : (
              <View style={{ width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: color }} />
            )}
          </Animated.View>
        </View>
      </Pressable>
    </View>
  );
}
