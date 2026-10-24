import { ContextMenuArea, showMenu, Symbol } from "@ardia/shell";
import { useEffect, useRef } from "react";
import { Animated, Pressable, ScrollView, Text, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { switchProfile } from "../../lib/actions";
import { useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useIsIncognito } from "../../store/hooks";
import { usePagerPages, type PagerPage } from "../layout/profilePager";
import { useHover } from "../primitives";
import { openSettings } from "../settings/windows";
import { isEmojiIcon } from "./emojiIcon";
import { PROFILE_SYMBOLS, profileInitial, profileSymbol } from "./icons";

export const PROFILE_DOTS_HEIGHT = 41;
const CELL = 12;
const DOT = 6;
const BAND = 28;
const SELECTED = 0.85;
const HOVERED = 0.4;
const IDLE = 0.2;
const ICON_CELL = 22;
const ICON = 13;
const ICON_HOVERED = 0.9;
const ICON_IDLE = 0.75;

export function useProfileDotsShown() {
  const incognito = useIsIncognito();
  const count = useBrowser((s) => s.profileOrder.length);
  return !incognito && count > 1;
}

const validIcon = (icon: string | null) => (icon && (isEmojiIcon(icon) || PROFILE_SYMBOLS.some((p) => `symbol:${p.name}` === icon)) ? icon : null);

export function profileDotsLayout(count: number, room: number) {
  if (count * ICON_CELL <= room) return { compact: false, overflow: false };
  return { compact: true, overflow: count * CELL > room };
}

export function ProfileDots({ windowId, width, sideRoom }: { windowId: string; width: number; sideRoom: number }) {
  const ids = useBrowser(useShallow((s) => s.profileOrder));
  const icons = useBrowser(useShallow((s) => s.profileOrder.map((id) => s.profiles[id]?.icon ?? null)));
  const current = useBrowser((s) => s.windows[windowId]?.profileId);
  const { pages, pager } = usePagerPages(windowId);
  const room = width - 2 * sideRoom;
  const fit = profileDotsLayout(ids.length, room);
  const scroller = useRef<ScrollView>(null);
  const currentIndex = Math.max(0, ids.indexOf(current ?? ""));
  useEffect(() => {
    if (fit.overflow) scroller.current?.scrollTo({ x: Math.max(0, currentIndex * CELL - room / 2 + CELL / 2), animated: false });
  }, [fit.overflow, currentIndex, room]);
  const cells = ids.map((id, i) => (
    <Dot key={id} id={id} windowId={windowId} icon={validIcon(icons[i] ?? null)} compact={fit.compact} page={pages.find((p) => p.id === id)} pos={pager.pos} />
  ));
  return (
    <View style={{ height: PROFILE_DOTS_HEIGHT, alignItems: "center" }}>
      <View style={{ marginTop: (PROFILE_DOTS_HEIGHT - 3 - BAND) / 2, height: BAND, flexDirection: "row" }}>
        {fit.overflow ? (
          <ScrollView ref={scroller} horizontal scrollEnabled={false} showsHorizontalScrollIndicator={false} style={{ width: room, height: BAND }}>
            {cells}
          </ScrollView>
        ) : (
          cells
        )}
      </View>
    </View>
  );
}

type DotProps = { id: string; windowId: string; icon: string | null; compact: boolean; page: PagerPage | undefined; pos: Animated.Value };

function Dot({ id, windowId, icon, compact, page, pos }: DotProps) {
  const theme = useTheme();
  const name = useBrowser((s) => s.profiles[id]?.name ?? "");
  const { hovered, hoverProps } = useHover();
  const ink = compact ? (theme.dark ? "#FFFFFF" : "#000000") : theme.textPrimary;
  const symbol = profileSymbol(icon);
  const rest = compact ? (hovered ? HOVERED : IDLE) : hovered ? ICON_HOVERED : ICON_IDLE;
  const selected = compact ? SELECTED : 1;
  const opacity = page
    ? pos.interpolate({ inputRange: [page.slot - 1, page.slot, page.slot + 1], outputRange: [rest, selected, rest], extrapolate: "clamp" })
    : rest;
  return (
    <View {...hoverProps} tooltip={name}>
      <ContextMenuArea onContextMenu={() => void openDotMenu(id)}>
        <Pressable accessibilityRole="button" accessibilityLabel={name} onPress={() => switchProfile(windowId, id, true)}>
          <View style={{ width: compact ? CELL : ICON_CELL, height: BAND, alignItems: "center", justifyContent: "center" }}>
            <Animated.View style={{ opacity }}>
              {compact ? (
                <View style={{ width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: ink }} />
              ) : symbol ? (
                <Symbol name={symbol} size={ICON} weight="semibold" color={ink} style={{ width: ICON_CELL, height: BAND }} />
              ) : icon ? (
                <Text style={{ fontSize: ICON }}>{icon}</Text>
              ) : (
                <Text style={{ fontSize: ICON, fontWeight: "600", color: ink }}>{profileInitial(name)}</Text>
              )}
            </Animated.View>
          </View>
        </Pressable>
      </ContextMenuArea>
    </View>
  );
}

async function openDotMenu(id: string) {
  const choice = await showMenu([{ id: "edit", title: "Edit Profile…", symbol: "pencil" }]);
  if (choice === "edit") openSettings("profiles", id);
}
