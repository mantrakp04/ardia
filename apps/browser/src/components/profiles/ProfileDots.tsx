import { useCallback, useEffect, useRef, useState } from "react";
import { profileMark } from "../../lib/profileInitial";
import { Animated, Pressable, ScrollView, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { switchProfile } from "../../state/browser/actions";
import { noteSwitcherPress } from "../../state/telemetry/switcherPresses";
import { layout, useTheme } from "../ui/theme";
import { useIsIncognito, useProfile, useSettings, useWindowProfileId } from "../../state/browser/hooks";
import { useProfileOrder, useProfileRecords } from "../../state/profiles/hooks";
import { useNativePagerPosition, usePagerPages, type PagerPage } from "../../state/windows/profilePager";
import { ContextMenuArea, radius, useHover } from "../ui";
import { SIDEBAR_FOOTER_DOWNLOADS } from "../sidebar/geometry";
import { switcherCellWidth, SwitcherMark } from "./ProfileIcons";
import { openProfileItemMenu } from "./profileMenu";
import { profileSwitcher } from "./tokens";
import { ProfileIndicator } from "./ProfileIndicator";
import { switcherScrollOffset } from "./profileSwitcherLayout";

export const PROFILE_DOTS_HEIGHT = profileSwitcher.height;
const { band: BAND } = profileSwitcher;
export const PROFILE_NAME_HEIGHT = 34;
const SIDE_ROOM = layout.sidebarInset;
const SIDE_ROOM_BESIDE_DOWNLOADS = SIDEBAR_FOOTER_DOWNLOADS.left + SIDEBAR_FOOTER_DOWNLOADS.size + 4;

export function useProfileDotsShown() {
  const incognito = useIsIncognito();
  const count = useProfileOrder((o) => o.length);
  return !incognito && count > 1;
}

export function ProfileDots({ windowId, width, besideDownloads, showName = false }: { windowId: string; width: number; besideDownloads: boolean; showName?: boolean }) {
  const ids = useProfileOrder(useShallow((o) => o));
  const saved = useProfileRecords(useShallow((profiles) => ids.map((id) => profiles[id] ? profileMark(profiles[id]) : null)));
  const shown = useSettings((s) => s.profileSwitcherIcons);
  const icons = shown ? saved : saved.map(() => null);
  const room = Math.max(0, width - 2 * (besideDownloads ? SIDE_ROOM_BESIDE_DOWNLOADS : SIDE_ROOM));
  const contentWidth = icons.reduce((sum, icon) => sum + switcherCellWidth(icon), 0);
  const active = useWindowProfileId();
  const scroll = useRef<ScrollView>(null);
  const revealActive = useCallback(() => {
    const index = ids.indexOf(active);
    scroll.current?.scrollTo({ x: switcherScrollOffset(icons.map(switcherCellWidth), index, room), animated: false });
  }, [active, ids.join("|"), shown, room, contentWidth]);
  useEffect(revealActive, [revealActive]);
  const { pages, pager } = usePagerPages(windowId);
  return (
    <View style={{ height: PROFILE_DOTS_HEIGHT + (showName ? PROFILE_NAME_HEIGHT : 0), alignItems: "center" }}>
      {showName ? <ProfileIndicator room={width - 2 * SIDE_ROOM} expanded /> : null}
      <ScrollView ref={scroll} onContentSizeChange={revealActive} horizontal showsHorizontalScrollIndicator={false} style={{ width: room, marginTop: (PROFILE_DOTS_HEIGHT - 3 - BAND) / 2, height: BAND, flexGrow: 0, overflow: "hidden" }} contentContainerStyle={{ minWidth: room, justifyContent: "center", alignItems: "center", flexDirection: "row" }}>
        {ids.map((id, i) => (
          <Dot key={id} id={id} windowId={windowId} icon={icons[i] ?? null} page={pages.find((p) => p.id === id)} pos={pager.pos} selected={active === id} />
        ))}
      </ScrollView>
    </View>
  );
}

function Dot({ id, windowId, icon, page, pos, selected }: { selected: boolean; id: string; windowId: string; icon: string | null; page: PagerPage | undefined; pos: Animated.Value }) {
  const theme = useTheme();
  useNativePagerPosition(windowId);
  const name = useProfile(id, (p) => p?.name ?? "");
  const { hovered, hoverProps } = useHover();
  const [pressed, setPressed] = useState(false);
  if (pressed && !hovered) setPressed(false);
  const levels = icon ? profileSwitcher.icons : profileSwitcher.dots;
  const rest = hovered ? levels.hovered : levels.idle;
  const opacity = page
    ? pos.interpolate({ inputRange: [page.slot - 1, page.slot, page.slot + 1], outputRange: [rest, levels.selected, rest], extrapolate: "clamp" })
    : rest;
  const cell = switcherCellWidth(icon);
  const mark = useRef<View>(null);
  return (
    <View {...hoverProps} ref={mark} tooltip={name}>
      <ContextMenuArea onContextMenu={() => void openProfileItemMenu(id, "sidebar", windowId, mark.current)}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={name}
          accessibilityState={{ selected }}
          onPress={() => {
            setPressed(true);
            noteSwitcherPress(windowId, id, !!icon);
            switchProfile(windowId, id, true);
          }}
        >
          <View style={{ width: icon ? BAND : cell, marginHorizontal: icon ? (cell - BAND) / 2 : 0, height: BAND, alignItems: "center", justifyContent: "center", borderRadius: radius.chrome, backgroundColor: icon && selected ? theme.tabPressed : undefined }}>
            <Animated.View style={{ opacity }}>
              <SwitcherMark icon={icon} color={theme.mark} />
            </Animated.View>
          </View>
        </Pressable>
      </ContextMenuArea>
    </View>
  );
}
