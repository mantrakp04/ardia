import { Symbol } from "@ardia/shell";
import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, ScrollView, Text, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { switchProfile } from "../../lib/actions";
import { layout, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useIsIncognito } from "../../store/hooks";
import { usePagerPages, type PagerPage } from "../layout/profilePager";
import { SIDEBAR_FOOTER_DOWNLOADS } from "../layout/windowLayout";
import { useHover } from "../primitives";
import { TooltipAbove } from "../TooltipAbove";
import { profileSymbol } from "./icons";

export const PROFILE_DOTS_HEIGHT = 41;
const CELL = 12;
const DOT = 6;
const ICON_CELL = 20;
const ICON = 14;
const BAND = 28;
const SELECTED = 0.85;
const HOVERED = 0.4;
const IDLE = 0.2;
const DOT_CENTER_TO_TOOLTIP = 18.25;

export function useProfileDotsShown() {
  const incognito = useIsIncognito();
  const count = useBrowser((s) => s.profileOrder.length);
  return !incognito && count > 1;
}

export function ProfileDots({ windowId, downloads = false }: { windowId: string; downloads?: boolean }) {
  const ids = useBrowser(useShallow((s) => s.profileOrder));
  const { pages, pager } = usePagerPages(windowId);
  const icons = useBrowser((s) => s.settings.profileSwitcher === "icons");
  const activeId = useBrowser((s) => s.windows[windowId]?.profileId);
  const scroll = useRef<ScrollView>(null);
  const [width, setWidth] = useState(0);
  const activeIndex = ids.indexOf(activeId ?? "");
  useEffect(() => {
    if (icons && width > 0 && activeIndex >= 0) scroll.current?.scrollTo({ x: Math.max(0, (activeIndex + 0.5) * ICON_CELL - width / 2), animated: false });
  }, [icons, width, activeIndex, ids.length]);
  const items = ids.map((id) => (
    <Dot key={id} id={id} windowId={windowId} page={pages.find((p) => p.id === id)} pos={pager.pos} icons={icons} />
  ));
  return (
    <View style={{ height: PROFILE_DOTS_HEIGHT, alignItems: "center" }}>
      {icons ? (
        <View style={{ alignSelf: "stretch", marginLeft: downloads ? layout.sidebarInset + SIDEBAR_FOOTER_DOWNLOADS.size + 2 : 8, marginRight: 8, marginTop: (PROFILE_DOTS_HEIGHT - 3 - BAND) / 2, height: BAND }}>
          <ScrollView
            ref={scroll}
            horizontal
            showsHorizontalScrollIndicator={false}
            onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
            contentContainerStyle={{ flexGrow: 1, justifyContent: "center", alignItems: "center" }}
          >
            {items}
          </ScrollView>
        </View>
      ) : (
        <View style={{ marginTop: (PROFILE_DOTS_HEIGHT - 3 - BAND) / 2, height: BAND, flexDirection: "row" }}>{items}</View>
      )}
    </View>
  );
}

function Dot({ id, windowId, page, pos, icons }: { id: string; windowId: string; page: PagerPage | undefined; pos: Animated.Value; icons: boolean }) {
  const theme = useTheme();
  const profile = useBrowser((s) => s.profiles[id]);
  const selected = useBrowser((s) => s.windows[windowId]?.profileId === id);
  const name = profile?.name ?? "";
  const symbol = profileSymbol(profile?.icon ?? null);
  const color = theme.dark ? "#FFFFFF" : "#000000";
  const { hovered, hoverProps } = useHover();
  const [pressed, setPressed] = useState(false);
  if (pressed && !hovered) setPressed(false);
  const rest = icons ? (hovered ? 0.85 : 0.55) : hovered ? HOVERED : IDLE;
  const opacity = page
    ? pos.interpolate({ inputRange: [page.slot - 1, page.slot, page.slot + 1], outputRange: [rest, SELECTED, rest], extrapolate: "clamp" })
    : rest;
  const underline = page
    ? pos.interpolate({ inputRange: [page.slot - 1, page.slot, page.slot + 1], outputRange: [0, SELECTED, 0], extrapolate: "clamp" })
    : 0;
  return (
    <View {...hoverProps} tooltip={icons ? name : undefined}>
      {icons ? null : <TooltipAbove text={name} active={hovered && !pressed} centerX={CELL / 2} bottom={BAND / 2 + DOT_CENTER_TO_TOOLTIP} />}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={name}
        accessibilityState={{ selected }}
        onPress={() => {
          setPressed(true);
          switchProfile(windowId, id, true);
        }}
      >
        <View style={{ width: icons ? ICON_CELL : CELL, height: BAND, alignItems: "center", justifyContent: "center" }}>
          {icons ? (
            <>
              <Animated.View style={{ opacity, width: ICON, height: ICON + 2, alignItems: "center", justifyContent: "center" }}>
                {symbol ? (
                  <Symbol name={symbol} size={ICON} weight="semibold" color={color} style={{ width: ICON, height: ICON + 2 }} />
                ) : (
                  <Text numberOfLines={1} style={{ fontSize: ICON, fontWeight: "600", color }}>{profile?.icon ?? (Array.from(name.trim())[0] ?? "?").toUpperCase()}</Text>
                )}
              </Animated.View>
              <Animated.View style={{ position: "absolute", bottom: 1, width: 10, height: 2, borderRadius: 1, backgroundColor: color, opacity: underline }} />
            </>
          ) : (
            <Animated.View style={{ width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: color, opacity }} />
          )}
        </View>
      </Pressable>
    </View>
  );
}
